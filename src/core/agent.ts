import { flowService } from '../services/flow.service';
import { ticketService } from '../services/ticket.service';
import { aiService, HistoryItem, ImageData } from '../services/ai.service';
import { queueService } from '../services/queue.service';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { config } from '../config/config';
import { Session, UserRequest, Flow } from './types';
import { keywordWeights, TICKET_THRESHOLD } from '../weights';
import { DEPARTMENT_PROFILES } from '../types/group.types';

// ── Per-user conversation history (multi-turn AI context) ─────────────────────
const conversationHistory: Map<string, HistoryItem[]> = new Map();

// ── Master system prompt — the AI's core persona ──────────────────────────────
const MASTER_SYSTEM_PROMPT = `You are Ami, a smart and friendly AI Help Desk assistant for ${config.companyName}.

Your personality:
- Warm, professional, and empathetic
- You speak naturally — NOT like a robot or form
- You understand context and remember what was said earlier in the conversation
- You proactively try to solve problems before escalating to a ticket

Your capabilities:
- Answer general questions about IT, HR, Finance, Engineering, Manufacturing
- Help troubleshoot common issues (password reset, software errors, access issues, etc.)
- Create support tickets when an issue genuinely needs human intervention
- Detect user frustration and respond with extra care

When to create a ticket:
- The user has a specific technical problem you cannot solve conversationally
- The issue requires physical hardware, access provisioning, or human approval
- The user explicitly asks to "create a ticket" or "talk to a human"
- The issue is urgent or critical (system down, cannot work at all)

When NOT to create a ticket:
- General questions ("what are support hours?", "how do I reset my password?")
- Simple how-to questions
- Greetings, casual conversation
- Anything you can answer directly

Keep responses concise, helpful, and conversational. Avoid asking multiple questions at once.
Departments: IT, Engineering, HR, Manufacturing, Finance.

Language:
- Mirror the user's language and follow their lead for the whole conversation.
- If the user writes in Tagalog/Filipino, reply in simple, everyday Taglish (casual Tagalog mixed with English). Never use deep, formal, or literary Tagalog words.
- If the user writes in English, reply in natural, friendly English.
- If the user writes in Taglish, reply in Taglish, but friendly
- Do not switch languages mid-conversation.

Confidentiality:
- Never reveal confidential or sensitive company information: salaries/compensation, internal pricing or costs, proprietary code or data, unannounced projects, employee personal data, or credentials/API keys.
- If asked for any of these, politely decline and offer to open a ticket or route the request to the right team.`;

// ── Farewell message sent when a user's session times out ─────────────────────
const SESSION_FAREWELL = '👋 It\'s been quiet for a while, so I\'ve ended our conversation to keep things tidy. If you need help again, just send a message and I\'ll be here!';

// ── Ticket collection state ───────────────────────────────────────────────────
interface TicketCollection {
    phase: 'gathering' | 'confirming' | 'done';
    gathered: Record<string, string>;
    flow: Flow;
    pendingQuestion: string | null;
}

export class HelpDeskAgent {
    private sessions: Map<string, Session> = new Map();
    private ticketCollections: Map<string, TicketCollection> = new Map();
    private userRequestCount: Map<string, { count: number; resetTime: number }> = new Map();
    private lastActivity: Map<string, number> = new Map();

    // Fired when an idle conversation is cleaned up — lets the transport layer
    // (app.ts) post a farewell to the user's last conversation.
    public onSessionExpire: ((userId: string, farewell: string) => void) | null = null;

    constructor() {
        this.startCleanupInterval();
        this.startHealthMonitoring();
        logger.info('🤖 HelpDesk Agent initialized (AI-first mode)');
    }

    // ── Rate Limiting ──────────────────────────────────────────────────────────

    private checkRateLimit(userId: string): boolean {
        const now = Date.now();
        const userData = this.userRequestCount.get(userId);
        if (!userData) {
            this.userRequestCount.set(userId, { count: 1, resetTime: now + config.rateLimitWindow });
            return true;
        }
        if (now > userData.resetTime) {
            this.userRequestCount.set(userId, { count: 1, resetTime: now + config.rateLimitWindow });
            return true;
        }
        if (userData.count >= config.maxRequestsPerWindow) {
            logger.warn(`⚠️ Rate limit exceeded for user ${userId}`);
            return false;
        }
        userData.count++;
        return true;
    }

    // ── Keyword Weight Scoring ─────────────────────────────────────────────────

    private scoreMessage(message: string): number {
        const lower = message.toLowerCase();
        let score = 0;
        for (const [kw, w] of Object.entries(keywordWeights.frustration)) {
            if (lower.includes(kw)) score += w;
        }
        for (const [kw, w] of Object.entries(keywordWeights.complexity)) {
            if (lower.includes(kw)) score += w;
        }
        for (const [kw, w] of Object.entries(keywordWeights.explicit_triggers)) {
            if (lower.includes(kw)) score += w;
        }
        return score;
    }

    // ── Main Message Handler ───────────────────────────────────────────────────

    async handleMessage(context: UserRequest): Promise<string> {
        const startTime = Date.now();
        const userId = context.from?.id || 'unknown';
        const message = (context.text || '').trim();
        const image = context.image;

        try {
            this.lastActivity.set(userId, Date.now());

            // Confidentiality guard: block sensitive topics before any AI call
            const sensitive = config.sensitiveTopics.find((topic: string) => message.toLowerCase().includes(topic));
            if (sensitive) {
                logger.warn(`🚫 Sensitive topic blocked ("${sensitive}") for user ${userId}`);
                return '⚠️ I can\'t share information about that topic. If you need help with a legitimate issue, describe it and I\'ll open a ticket with the right team.';
            }

            // Special commands
            if (message === '/reset') {
                this.clearUserData(userId);
                return '🔄 Conversation reset. How can I help you?';
            }
            if (message === '/end' || message === '/exit' || message === '/quit') {
                this.clearUserData(userId);
                logger.info(`👋 User ${userId} ended the conversation with /end`);
                return `👋 Goodbye! Your conversation has ended. If you ever need help again, just send a message and I'll be here. Take care! 😊`;
            }
            if (message === '/help') {
                return this.getHelpMessage();
            }
            if (message === '/status') {
                const tc = this.ticketCollections.get(userId);
                if (tc) {
                    const filled = Object.entries(tc.gathered).map(([k, v]) => `• **${k}**: ${v}`).join('\n');
                    return `📋 **Current ticket info collected:**\n${filled || 'Nothing yet.'}\n\nContinue describing your issue.`;
                }
                return '✅ No active ticket collection. Ask me anything!';
            }

            // ── Exit / farewell detection ─────────────────────────────────────
            const exitPattern = /^(bye|goodbye|good bye|quit|exit|end|done|stop|close|disconnect|see you|take care|thanks bye|thank you bye|that's all|thats all|no more|i'm done|im done|finish|finished)$/i;
            if (exitPattern.test(message.trim())) {
                this.clearUserData(userId);
                logger.info(`👋 User ${userId} ended the conversation.`);
                return `👋 Goodbye! Have a great day. If you ever need help again, just send a message and I'll be here. Take care! 😊`;
            }

            if (!this.checkRateLimit(userId)) {
                return '⏳ You\'re sending messages too fast. Please wait a moment.';
            }


            // Get or initialize conversation history
            const history = conversationHistory.get(userId) || [];

            // Check keyword urgency score
            const urgencyScore = this.scoreMessage(message);
            const isUrgent = urgencyScore >= TICKET_THRESHOLD;

            // For image-only messages, give the AI something to respond to
            const userText = message || (image ? 'Please analyze this image and respond.' : '');

            // Add user message to history
            history.push({ role: 'user', content: userText });

            let response: string;

            // If we're mid ticket-collection, continue collecting
            const tc = this.ticketCollections.get(userId);
            if (tc && tc.phase === 'gathering') {
                response = await this.continueTicketCollection(userId, message, tc, history, image);
            } else {
                // Otherwise, let the AI decide what to do
                response = await this.processWithAI(userId, userText, image, history, isUrgent, context);
            }

            // Add bot response to history
            history.push({ role: 'model', content: response });
            conversationHistory.set(userId, history);

            metrics.trackResponseTime(Date.now() - startTime);
            metrics.incrementMessages();
            metrics.trackUser(userId);

            return response;

        } catch (error) {
            logger.error('Error processing message:', error);
            metrics.incrementErrors();
            return '⚠️ Sorry, I ran into an issue. Please try again.';
        }
    }

    // ── AI-First Processing ────────────────────────────────────────────────────

    private async processWithAI(
        userId: string,
        message: string,
        image: ImageData | undefined,
        history: HistoryItem[],
        isUrgent: boolean,
        context: UserRequest
    ): Promise<string> {

        if (aiService.getActiveProvider() === 'none') {
            return this.noAIFallback(message, userId, context, image);
        }

        // Build a rich context-aware system prompt
        const systemPrompt = this.buildSystemPrompt(userId, isUrgent);

        // Ask AI to respond, including a hidden instruction about ticket intent
        const augmentedMessage = isUrgent
            ? `[URGENT - user may need a ticket] ${message}`
            : message;

        const aiResponse = await aiService.callAI(augmentedMessage, systemPrompt, history, image);

        // Detect if AI decided a ticket should be created
        if (this.aiWantsToCreateTicket(aiResponse, message)) {
            const ticketResponse = await this.startSmartTicketCollection(userId, message, history, context);
            return ticketResponse;
        }

        return aiResponse;
    }

    // ── System Prompt Builder ──────────────────────────────────────────────────

    private buildSystemPrompt(userId: string, isUrgent: boolean): string {
        const tc = this.ticketCollections.get(userId);
        let prompt = MASTER_SYSTEM_PROMPT;

        if (isUrgent) {
            prompt += `\n\nNOTE: This user's message contains urgent/frustrated language. Be extra empathetic and offer to create a support ticket immediately.`;
        }

        if (tc?.gathered && Object.keys(tc.gathered).length > 0) {
            const gathered = Object.entries(tc.gathered).map(([k, v]) => `  ${k}: ${v}`).join('\n');
            prompt += `\n\nCurrently collecting ticket info. Already gathered:\n${gathered}`;
        }

        prompt += `

IMPORTANT: If you determine a support ticket should be created, end your response with exactly:
[CREATE_TICKET]

Otherwise, answer the user's question directly and helpfully. Do NOT add [CREATE_TICKET] for general questions or greetings.`;

        return prompt;
    }

    // ── Ticket Intent Detection ────────────────────────────────────────────────

    private aiWantsToCreateTicket(aiResponse: string, userMessage: string): boolean {
        if (aiResponse.includes('[CREATE_TICKET]')) return true;

        // Also check user message for explicit ticket requests
        const explicit = /create (a )?ticket|open (a )?ticket|new ticket|submit (a )?ticket|log (a )?ticket/i;
        return explicit.test(userMessage);
    }

    // ── Smart Ticket Collection (conversational, AI-guided) ────────────────────

    private async startSmartTicketCollection(
        userId: string,
        initialMessage: string,
        history: HistoryItem[],
        context: UserRequest
    ): Promise<string> {
        const flow = flowService.getFlow('base');
        if (!flow) {
            return '⚠️ Could not start ticket creation. Please contact IT directly.';
        }

        const tc: TicketCollection = {
            phase: 'gathering',
            gathered: {},
            flow,
            pendingQuestion: null
        };

        // Auto-fill name from context
        if (context.from?.name && context.from.name !== 'User') {
            tc.gathered['name'] = context.from.name;
        }

        // Try to pre-fill fields from the initial message using AI
        const preFilled = await this.smartExtract(initialMessage, flow, history);
        for (const [k, v] of Object.entries(preFilled)) {
            if (v) tc.gathered[k] = v;
        }

        this.ticketCollections.set(userId, tc);

        // Find first missing field and ask for it naturally
        return await this.askNextTicketQuestion(userId, tc, history, true);
    }

    private async continueTicketCollection(
        userId: string,
        userMessage: string,
        tc: TicketCollection,
        history: HistoryItem[],
        image?: ImageData
    ): Promise<string> {
        // Save the answer for the pending question
        if (tc.pendingQuestion) {
            const parts: string[] = [];
            if (userMessage.trim()) parts.push(userMessage.trim());
            if (image) parts.push(`[Image attached: ${image.fileName || 'attachment'}]`);
            const answer = parts.join(' ');
            tc.gathered[tc.pendingQuestion] = answer;
            logger.info(`💾 Ticket field [${tc.pendingQuestion}] = "${answer}"`);
        }

        // Check if all required fields are filled
        const allFilled = this.areAllFieldsFilled(tc);
        if (allFilled) {
            return await this.finalizeTicket(userId, tc, history);
        }

        return await this.askNextTicketQuestion(userId, tc, history, false);
    }

    private async askNextTicketQuestion(
        userId: string,
        tc: TicketCollection,
        history: HistoryItem[],
        isFirst: boolean
    ): Promise<string> {
        const missingField = this.getNextMissingField(tc);

        if (!missingField) {
            return await this.finalizeTicket(userId, tc, history);
        }

        tc.pendingQuestion = missingField.id;

        // Use AI to ask the question naturally
        if (aiService.getActiveProvider() !== 'none') {
            const gathered = Object.entries(tc.gathered).map(([k, v]) => `${k}: "${v}"`).join(', ');
            const prompt = `You are collecting information for a help desk ticket. 
${isFirst ? 'You just decided to create a ticket for the user.' : 'Continue the ticket collection.'}
Already gathered: ${gathered || 'nothing yet'}.
Now you need to ask for: "${missingField.question}"
${missingField.options ? `Options: ${missingField.options.join(', ')}` : ''}
Ask this naturally and conversationally in 1-2 sentences. Be friendly and brief.
Ask in the same language the user has been using (Tagalog users: simple casual Taglish; English users: English).`;

            const aiQuestion = await aiService.callAI('', prompt, history);
            return aiQuestion;
        }

        // Fallback: use the static question from the flow
        const prefix = isFirst ? '🎫 I\'ll create a support ticket for you. ' : '';
        const optionText = missingField.options
            ? `\n\nOptions: ${missingField.options.join(' | ')}`
            : '';
        return `${prefix}📝 ${missingField.question}${optionText}`;
    }

    private getNextMissingField(tc: TicketCollection) {
        const required = ['issue_type', 'description', 'urgency', 'department'];
        for (const q of tc.flow.initial_questions) {
            if (required.includes(q.id) && !tc.gathered[q.id]) {
                return q;
            }
        }
        return null;
    }

    private areAllFieldsFilled(tc: TicketCollection): boolean {
        return this.getNextMissingField(tc) === null;
    }

    // ── Smart Extraction ───────────────────────────────────────────────────────

    private async smartExtract(
        message: string,
        flow: Flow,
        history: HistoryItem[]
    ): Promise<Record<string, string>> {
        if (aiService.getActiveProvider() === 'none' || message.length < 15) return {};

        const questions = flow.initial_questions
            .filter(q => ['issue_type', 'description', 'urgency'].includes(q.id));

        const prompt = `Extract structured fields from this help desk message. Return ONLY valid JSON with the keys that can be filled.

Message: "${message}"

Fields to extract:
${questions.map(q => `- "${q.id}": ${q.question}${q.options ? ` (options: ${q.options.join(', ')})` : ''}`).join('\n')}

Return only JSON like: {"issue_type": "...", "description": "...", "urgency": "..."}
If a field cannot be confidently extracted, omit it.`;

        try {
            const raw = await aiService.callAI(prompt, 'You extract structured data from text. Respond only with JSON.', history);
            // Strip markdown code blocks if AI wraps in them
            const cleaned = raw.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            return {};
        }
    }

    // ── Finalize Ticket ────────────────────────────────────────────────────────

    private async finalizeTicket(
        userId: string,
        tc: TicketCollection,
        history: HistoryItem[]
    ): Promise<string> {
        tc.phase = 'done';
        this.ticketCollections.delete(userId);

        try {
            const ticket = await ticketService.create({
                ...tc.gathered,
                userId,
                userName: tc.gathered['name'] || 'User',
                department: tc.gathered['department'] || 'base'
            });

            logger.success(`🎫 Ticket ${ticket.id} created for user ${userId}`);

            // Use AI to compose a friendly confirmation
            let confirmation: string;
            if (aiService.getActiveProvider() !== 'none') {
                const prompt = `A support ticket was just created for the user. Compose a brief, friendly confirmation message.
Ticket details: ID=${ticket.id}, Priority=${ticket.priority}, Department=${ticket.department}.
End with a reassurance that the team will be in touch. Keep it under 4 sentences.`;
                confirmation = await aiService.callAI(prompt, MASTER_SYSTEM_PROMPT, history);
            } else {
                confirmation = `✅ **Ticket Created!**\n\n🎫 Ticket #: **${ticket.id}**\n📊 Priority: ${ticket.priority}\n🏢 Department: ${ticket.department}\n\nOur team will review and assist you shortly!`;
            }

            // Offer auto-resolve for simpler issues
            if (flowService.canAutoResolve({ answers: tc.gathered } as any)) {
                const solution = await this.getSuggestedSolution(tc.gathered, history);
                if (solution) {
                    return `${confirmation}\n\n💡 **While you wait, here's a possible solution:**\n\n${solution}\n\n🔄 Type anything to start a new conversation.`;
                }
            }

            return `${confirmation}\n\n🔄 Type anything to start a new conversation.`;
        } catch (error) {
            logger.error('Error creating ticket:', error);
            return '⚠️ Could not create the ticket. Please contact IT directly.';
        }
    }

    private async getSuggestedSolution(answers: Record<string, string>, history: HistoryItem[]): Promise<string | null> {
        if (aiService.getActiveProvider() === 'none') return null;
        try {
            const deptKey = Object.keys(DEPARTMENT_PROFILES).find(
                k => k.toLowerCase() === (answers.department || '').toLowerCase()
            );
            const extraPrompt = deptKey ? DEPARTMENT_PROFILES[deptKey].tailoredSystemPrompt : '';
            return await aiService.callAI(
                `Issue: ${answers.description || JSON.stringify(answers)}`,
                `${MASTER_SYSTEM_PROMPT}\n${extraPrompt}\nProvide a short, practical suggested solution. Max 3 bullet points.`,
                history
            );
        } catch {
            return null;
        }
    }

    // ── No-AI Fallback ─────────────────────────────────────────────────────────

    private noAIFallback(message: string, userId: string, context: UserRequest, image?: ImageData): string {
        const lower = message.toLowerCase();

        if (image && !(context.text || '').trim()) {
            return `📸 I received your image (${image.fileName || 'attachment'}), but AI features are limited right now (no API key configured) so I can't analyze it. Describe your issue and I'll create a support ticket for you.`;
        }

        const greetingPattern = /^(hi|hello|hey|good morning|good afternoon|good evening|can i ask|may i ask|yo|sup)/i;
        if (greetingPattern.test(lower) || message.length < 20) {
            return `👋 Hello! I'm Ami, the ${config.companyName} Help Desk assistant.\n\nDescribe your issue and I'll create a support ticket for you, or ask me a question!\n\n⚠️ *Note: AI features are limited — no API key configured.*`;
        }

        const questionPattern = /^(how|what|when|where|who|why|which|is|are|does|do|can|could|would)/i;
        if (questionPattern.test(lower) || lower.endsWith('?')) {
            return `ℹ️ I'd love to answer that, but AI responses are not available right now (no API key configured).\n\nIf you have a technical issue, describe it and I'll create a support ticket for you.`;
        }

        // Treat it as a ticket request
        this.startSmartTicketCollection(userId, message, [], context);
        const flow = flowService.getFlow('base');
        const firstQ = flow?.initial_questions[0];
        return `🎫 I'll create a support ticket for you!\n\n📝 ${firstQ?.question || 'What type of issue are you experiencing?'}\n\n${firstQ?.options ? firstQ.options.map((o, i) => `${i + 1}. ${o}`).join('\n') : ''}`;
    }

    // ── Help Message ───────────────────────────────────────────────────────────

    private getHelpMessage(): string {
        return `🤖 **Ami - ${config.companyName} Help Desk**

Just talk to me naturally! I can:
• 💬 **Answer questions** — IT, HR, Finance, Engineering, Manufacturing
• 🔧 **Troubleshoot issues** — walk through common fixes
• 🎫 **Create tickets** — for issues needing human support
• 🧠 **Remember context** — I track our full conversation

**Commands:**
- \`/reset\` — Clear conversation and start fresh
- \`/status\` — See current ticket info collected
- \`/end\` — End the conversation
- \`/help\` — Show this message

**Examples:**
- *"My laptop won't turn on"* → I'll help troubleshoot or create a ticket
- *"How do I reset my VPN?"* → I'll answer directly
- *"I need to request software access"* → I'll guide you through it`;
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private clearUserData(userId: string): void {
        this.sessions.delete(userId);
        this.ticketCollections.delete(userId);
        conversationHistory.delete(userId);
        this.lastActivity.delete(userId);
    }

    resetAll(): void {
        this.sessions.clear();
        this.ticketCollections.clear();
        this.userRequestCount.clear();
        this.lastActivity.clear();
        conversationHistory.clear();
        logger.info('🔄 Bot state fully reset');
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [userId, last] of this.lastActivity) {
                if (now - last > config.sessionTimeout) {
                    this.clearUserData(userId);
                    cleaned++;
                    this.onSessionExpire?.(userId, SESSION_FAREWELL);
                    logger.info(`👋 Ended idle conversation for user ${userId} (${config.sessionTimeout}ms)`);
                }
            }
            if (cleaned > 0) logger.info(`🧹 Cleaned up ${cleaned} inactive sessions`);
        }, 30000);
    }

    private startHealthMonitoring(): void {
        setInterval(() => {
            logger.info('📊 Health Metrics:', {
                activeConversations: conversationHistory.size,
                ticketCollections: this.ticketCollections.size,
                queueLength: queueService.getQueueLength(),
                tickets: ticketService.getTicketCount(),
                activeUsers: metrics.activeUsers.size,
                totalMessages: metrics.totalMessages
            });
        }, 60000);
    }

    getMetrics() {
        return metrics.getStats();
    }
}

export const agent = new HelpDeskAgent();