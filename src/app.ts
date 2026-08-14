import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { agent } from './core/agent';
import { ticketService } from './services/ticket.service';
import { flowService } from './services/flow.service';
import { accessService } from './services/access.service';
import { alertService } from './services/alert.service';
import { authenticateIncomingRequest, getBotToken } from './services/auth.service';
import { ImageHandler } from './handlers/image.handler';
import { config } from './config/config';
import { logger } from './utils/logger';

const USER_HELP = [
    '👋 **Ami Help Desk — how to use me**',
    '• Just chat naturally: say "hello", report an issue, or ask about the help desk.',
    '• `create a ticket` — start a ticket request (issue type, description, urgency, department).',
    '• 📸 Send a screenshot with your message for image analysis.',
    '• `@mention Ami` in group chats so I notice you.',
    '• `/reset` — clear conversation history and start fresh.',
    '• `/status` — see the ticket info collected so far.',
    '• `/end` (or `/exit`, `/quit`) — end the conversation.',
    '• `/help` — show this list.',
    '• `/admin` — check if you are an administrator.'
].join('\n');

const ADMIN_HELP = [
    '🛡️ Yes — you are an administrator. You can run every command below.',
    '',
    USER_HELP,
    '',
    '🛡️ **Admin commands**',
    '• `/allow <user-id>` — allow a user to chat 1:1 with Ami.',
    '• `/disallow <user-id>` — remove a user from the allowlist.',
    '• `/allowlist` — list allowed users and admins.',
    '• `/addadmin <user-id>` — make a user an administrator.',
    '• `/removeadmin <user-id>` — remove an administrator.',
    '• `/admins` — list administrators.',
    '• `/approve` — approve this group chat (Ami becomes active here).',
    '• `/restart` — soft restart: clear sessions, reload flows, access and alert config.',
    '• `/alert [status|on|off|mode both|gc|1to1|gcon|test]` — manage Help Desk issue alerts.',
    '• `/admin` — check your admin status.'
].join('\n');

const app = express();

app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

const imageHandler = new ImageHandler(config.allowedImageTypes, config.maxImageSizeMB, config.uploadDir);

// Last known activity per user, so an idle timeout can post a farewell to the
// conversation the user was last active in.
const userContexts: Map<string, any> = new Map();

// When the agent cleans up an idle session, post the farewell to that user
agent.onSessionExpire = (userId: string, farewell: string) => {
    const activity = userContexts.get(userId);
    if (activity) {
        sendReply(activity, farewell);
    }
};

app.post('/api/messages', async (req: Request, res: Response) => {
    // This bot uses an asynchronous reply pattern.
    // 1. Acknowledge the incoming message immediately with a 200 OK to avoid timeouts,
    //    especially in channels like Microsoft Teams.
    // 2. Process the message in the background.
    // 3. Send the actual reply as a new, "proactive" message to the conversation.
    res.status(200).send();

    try {
        const body = req.body;
        logger.info('📨 Incoming message:', body);

        // The emulator/test channel is a local testing tool: bypass all gating
        // (mention-only, approval, allowlist) so any session just works.
        // Hardening: this bypass only applies when the traffic genuinely comes
        // from the local emulator (loopback source) — a remote actor spoofing
        // channelId "emulator" still hits JWT validation + all the gates.
        const remoteAddr = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
        const fromLoopback = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === 'localhost';
        const isEmulator = (body.channelId === 'emulator' || body.channelId === 'test') && fromLoopback;

        // Validate the incoming activity (real Teams JWT) before doing anything else
        if (!(await authenticateIncomingRequest(req.headers, body, isEmulator))) {
            logger.warn('🚫 Rejected unauthenticated activity.');
            return;
        }

        // Handle conversationUpdate events (when user joins)
        if (body.type === 'conversationUpdate') {
            logger.info('👋 User joined the conversation');

            const membersAdded = body.membersAdded || [];
            const botAdded = membersAdded.some((m: any) => m.id === body.recipient?.id);
            const isGroupChat = body.conversation?.conversationType === 'groupChat';
            const isPersonal = body.conversation?.conversationType === 'personal' || body.conversation?.conversationType === undefined;

            // GC approval gate: bot was added to a group chat that isn't approved yet
            if (!isEmulator && isGroupChat && botAdded && !accessService.isApproved(body.conversation.id)) {
                if (!accessService.isNotified(body.conversation.id)) {
                    const notice = '⚠️ This group chat is not approved by the Help Desk administrator yet. Ami won\'t respond here until an administrator approves this chat.';
                    await sendReply(body, notice);
                    accessService.markNotified(body.conversation.id);
                }
                return;
            }

            // Personal chat: no welcome — the gate sends a one-time notice on the first message
            if (isPersonal && botAdded) {
                return;
            }

            const userAdded = membersAdded.find((m: any) => m.id !== body.recipient?.id);

            if (userAdded) {
                const welcomeText = '👋 Welcome to the Amertron Help Desk! I\'m Ami. Type "hello" to start.';
                await sendReply(body, welcomeText);
            }

            return;
        }

        // Handle message type
        if (body.type === 'message') {
            const isGroupChat = body.conversation?.conversationType === 'groupChat';
            const senderId = body.from?.id;

            // Remember admin conversations so issue alerts can be 1:1'd privately
            // (before the admin-command gate so commands also learn the ref)
            if (senderId) alertService.rememberConversation(senderId, body);

            // Anyone can check whether they are an administrator (works everywhere)
            const cmdText = removeMention((body.text || '').trim(), body.recipient?.id).trim();
            if (senderId && /^\/admin\b/i.test(cmdText)) {
                if (accessService.isAdmin(senderId)) {
                    await sendReply(body, ADMIN_HELP);
                } else {
                    await sendReply(body, '🔒 Admin access required. Type /help to see the commands available to you.');
                }
                return;
            }

            // Everyone gets the same help message; admin commands are revealed via /admin
            if (senderId && /^\/help\b/i.test(cmdText)) {
                await sendReply(body, USER_HELP);
                return;
            }

            // Admin commands work everywhere, including unapproved group chats
            if (senderId && accessService.isAdmin(senderId)) {
                const handled = await handleAdminCommand(body);
                if (handled) return;
            }

            // GC approval gate: stay silent in unapproved group chats
            if (!isEmulator && isGroupChat && !accessService.isApproved(body.conversation.id)) {
                logger.info(`🚫 Ignored message in unapproved group chat ${body.conversation.id}`);
                return;
            }

            // Personal chat gate: only allowed users may chat 1:1; others get a one-time notice then silence
            const isPersonal = body.conversation?.conversationType === 'personal' || body.conversation?.conversationType === undefined;
            if (!isEmulator && isPersonal && !accessService.isAllowedUser(senderId)) {
                if (!accessService.isNotified(body.conversation.id)) {
                    const notice = '👋 Hi! Ami only works inside approved group chats. Add me to a group chat and have the Help Desk administrator approve it with /approve.';
                    await sendReply(body, notice);
                    accessService.markNotified(body.conversation.id);
                } else {
                    logger.info(`🚫 Ignored message in personal chat ${body.conversation.id}`);
                }
                return;
            }

            // Check if bot was mentioned
            const isMentioned = checkIfBotMentioned(body);

            // For emulator: allow all messages (for testing)
            // For Teams: only respond when mentioned (personal chats don't require mentions)
            if (!isEmulator && !isMentioned && !isPersonal) {
                logger.info('🤖 Bot not mentioned, ignoring message');
                return;
            }

            // Remove mention from text (if mentioned)
            let cleanText = body.text || '';
            if (isMentioned) {
                cleanText = removeMention(cleanText, body.recipient?.id);
                body.text = cleanText;
                logger.info(`📝 Clean message (mentioned): "${cleanText}"`);
            }

            // For emulator, we keep the original text
            logger.info(`📝 Processing message: "${body.text}"`);

            // Validate request
            if (!body || !body.from || !body.from.id) {
                logger.error('❌ Invalid request:', body);
                return;
            }

            // Allowlist: only configured users may trigger Ami (admins always allowed).
            // Emulator/test channel bypasses this — it's a local testing tool.
            if (!isEmulator && !accessService.isAllowedUser(body.from.id)) {
                logger.info(`🚫 User ${body.from.id} not allowed, ignoring message`);
                return;
            }

            // Process image attachments (if any) before anything else
            let imageData: { mimeType: string; base64Data: string; fileName?: string } | null = null;
            if (Array.isArray(body.attachments) && body.attachments.length > 0) {
                imageData = await imageHandler.handleAttachments(body.attachments);
                if (imageData) {
                    logger.info(`📸 Image received from ${senderId}: ${imageData.fileName}`);
                }
            }

            // Handle empty text (unless an image was attached)
            if ((!body.text || body.text.trim() === '') && !imageData) {
                logger.warn('⚠️ Empty message received');
                const prompt = '👋 How can I help you today? Type "hello" to start.';
                await sendReply(body, prompt);
                return;
            }

            // Remember the user's last conversation so a farewell can be posted on timeout
            userContexts.set(senderId, body);

            // Process the message
            const responseText = await agent.handleMessage({ ...body, image: imageData || undefined });

            // Send the reply
            await sendReply(body, responseText);
            return;
        }

        // Unknown activity type
        logger.info(`✅ Received activity of type "${body.type}", no action taken.`);

    } catch (error) {
        logger.error('Error in messages endpoint:', error);
        // The response has already been sent, so we just log the error.
    }
});

// Helper: Admin runtime management commands
async function handleAdminCommand(activity: any): Promise<boolean> {
    const text = removeMention((activity.text || '').trim(), activity.recipient?.id).trim();
    const convId = activity.conversation?.id;

    const match = text.match(/^\/(allow|disallow|allowlist|addadmin|removeadmin|admins|approve|restart|alert)\b(.*)$/i);
    if (!match) return false;

    const cmd = match[1].toLowerCase();
    const arg = (match[2] || '').trim();

    switch (cmd) {
        case 'allow':
            if (!arg) { await sendReply(activity, 'Usage: /allow <user-id>'); return true; }
            accessService.allowUser(arg);
            await sendReply(activity, `✅ User ${arg} added to the allowlist.`);
            return true;

        case 'disallow':
            if (!arg) { await sendReply(activity, 'Usage: /disallow <user-id>'); return true; }
            if (accessService.disallowUser(arg)) {
                await sendReply(activity, `🚫 User ${arg} removed from the allowlist.`);
            } else {
                await sendReply(activity, '⚠️ User not allowed or is an admin (remove admin first).');
            }
            return true;

        case 'allowlist':
            await sendReply(activity, `👥 Allowed users:\n${accessService.listAllowed().map((id, i) => `${i + 1}. ${id}`).join('\n') || '(none)'}\n\n👮 Admins:\n${accessService.listAdmins().map((id, i) => `${i + 1}. ${id}`).join('\n') || '(none)'}`);
            return true;

        case 'addadmin':
            if (!arg) { await sendReply(activity, 'Usage: /addadmin <user-id>'); return true; }
            accessService.addAdmin(arg);
            await sendReply(activity, `✅ User ${arg} is now an administrator.`);
            return true;

        case 'removeadmin':
            if (!arg) { await sendReply(activity, 'Usage: /removeadmin <user-id>'); return true; }
            accessService.removeAdmin(arg);
            await sendReply(activity, `🚫 User ${arg} is no longer an administrator.`);
            return true;

        case 'admins':
            await sendReply(activity, `👮 Admins:\n${accessService.listAdmins().map((id, i) => `${i + 1}. ${id}`).join('\n') || '(none)'}`);
            return true;

        case 'approve':
            if (!convId) { await sendReply(activity, '⚠️ Could not identify this conversation.'); return true; }
            accessService.approve(convId);
            await sendReply(activity, '✅ This group chat has been approved by the administrator. Ami is now active here. Remember to @mention Ami to get a response.');
            return true;

        case 'restart':
            agent.resetAll();
            flowService.reload();
            accessService.reload();
            alertService.reload();
            await sendReply(activity, '🔄 Soft restart complete. Sessions cleared, flows, access and alert config reloaded.');
            return true;

        case 'alert': {
            const sub = (arg || '').toLowerCase();
            if (!sub || sub === 'status') {
                await sendReply(activity, alertService.getStatus());
                return true;
            }
            if (sub === 'on' || sub === 'enable') {
                alertService.setEnabled(true);
                await sendReply(activity, '🔔 Alerts enabled.');
                return true;
            }
            if (sub === 'off' || sub === 'disable') {
                alertService.setEnabled(false);
                await sendReply(activity, '🔕 Alerts disabled.');
                return true;
            }
            if (sub.startsWith('mode ')) {
                const mode = sub.split(' ')[1];
                if (['both', 'gc', '1to1'].includes(mode)) {
                    alertService.setMode(mode as 'both' | 'gc' | '1to1');
                    await sendReply(activity, `📣 Alert mode set to ${mode}.`);
                    return true;
                }
                await sendReply(activity, 'Usage: /alert mode both|gc|1to1');
                return true;
            }
            if (sub === 'gcon') {
                if (!convId) { await sendReply(activity, '⚠️ Could not identify this conversation.'); return true; }
                alertService.registerAdminGC(activity);
                await sendReply(activity, `🏢 This group chat is now the admin alert channel (${convId}).`);
                return true;
            }
            if (sub === 'test') {
                const summary = await alertService.testAlert();
                await sendReply(activity, summary);
                return true;
            }
            await sendReply(activity, 'Alert commands: (alone = status), on, off, mode both|gc|1to1, gcon, test');
            return true;
        }

        default:
            return false;
    }
}

// Helper: Check if bot was mentioned
function checkIfBotMentioned(activity: any): boolean {
    // Check mentions array
    if (activity.mentions && activity.mentions.length > 0) {
        const botId = activity.recipient?.id;
        const isMentioned = activity.mentions.some((mention: any) => {
            return mention.mentioned?.id === botId;
        });
        if (isMentioned) return true;
    }

    // Check if message contains @Bot or @bot
    const text = activity.text || '';
    const botName = activity.recipient?.name || 'Ami';
    const mentionPattern = new RegExp(`@${botName}`, 'i');
    if (mentionPattern.test(text)) return true;

    // Check for <at> tags (Teams format)
    if (/<at[^>]*>.*?<\/at>/i.test(text)) {
        return true;
    }

    return false;
}

// Helper: Remove mention from text
function removeMention(text: string, botId: string): string {
    if (!text) return '';

    let cleanText = text;

    // Remove XML tags (Teams format)
    cleanText = cleanText.replace(/<at[^>]*>.*?<\/at>/gi, '');

    // Remove @mention patterns
    cleanText = cleanText.replace(/@Ami/gi, '');
    cleanText = cleanText.replace(/@Bot/gi, '');

    // Remove mention IDs
    if (botId) {
        cleanText = cleanText.replace(new RegExp(`<at id="${botId}">.*?<\/at>`, 'gi'), '');
    }

    // Clean up extra spaces
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    return cleanText;
}

// Helper: Send a reply to the user
async function sendReply(originalActivity: any, text: string): Promise<void> {
    const reply: any = {
        type: 'message',
        textFormat: 'markdown',
        from: { id: originalActivity.recipient.id, name: originalActivity.recipient.name },
        conversation: { id: originalActivity.conversation.id },
        recipient: { id: originalActivity.from.id, name: originalActivity.from.name },
        text: text,
        replyToId: originalActivity.id,
    };

    // Mention the user Ami is talking to, so everyone in a group chat knows
    // who the reply is for (real Teams mention; plain text fallback).
    const mention = buildMention(originalActivity);
    if (mention) {
        reply.text = `${mention.text} ${text}`;
        reply.entities = [mention.entity];
    }

    const serviceUrl = originalActivity.serviceUrl;
    const conversationId = originalActivity.conversation.id;

    // The endpoint for posting the reply is serviceUrl + /v3/conversations/{conversationId}/activities
    const replyUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities`;

    try {
        logger.info('📤 Sending reply:', {
            url: replyUrl,
            text: (text || '').substring(0, 50) + '...'
        });

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = await getBotToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // We don't have auth set up, so we send without a token.
        // This is fine for the emulator but will require auth for real channels.
        await axios.post(replyUrl, reply, { headers });

    } catch (error: any) {
        logger.error('❌ Error sending reply:', error.response?.data || error.message);
    }
}

// Build a Teams mention for the sender of an activity (null when not applicable)
function buildMention(activity: any): { text: string; entity: any } | null {
    if (activity.type !== 'message') return null;
    const sender = activity.from;
    if (!sender || !sender.id || sender.id === activity.recipient?.id) return null;

    if (sender.name) {
        const mentionText = `<at>${sender.name}</at>`;
        return {
            text: mentionText,
            entity: { type: 'mention', mentioned: { id: sender.id, name: sender.name }, text: mentionText }
        };
    }
    return { text: `@${sender.id}`, entity: null };
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        company: config.companyName,
        departments: config.departments,
        metrics: agent.getMetrics(),
        timestamp: new Date().toISOString()
    });
});

// Tickets endpoint
app.get('/api/tickets', (_req: Request, res: Response) => {
    res.json(ticketService.getAllTickets());
});

// Error handling
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

export { app };