import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { agent } from './core/agent';
import { ticketService } from './services/ticket.service';
import { flowService } from './services/flow.service';
import { accessService } from './services/access.service';
import { config } from './config/config';
import { logger } from './utils/logger';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

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

        // Handle conversationUpdate events (when user joins)
        if (body.type === 'conversationUpdate') {
            logger.info('👋 User joined the conversation');

            const membersAdded = body.membersAdded || [];
            const botAdded = membersAdded.some((m: any) => m.id === body.recipient?.id);
            const isGroupChat = body.conversation?.conversationType === 'groupChat';

            // GC approval gate: bot was added to a group chat that isn't approved yet
            if (isGroupChat && botAdded && !accessService.isApproved(body.conversation.id)) {
                if (!accessService.isNotified(body.conversation.id)) {
                    const notice = '⚠️ This group chat is not approved by the Help Desk administrator yet. Ami won\'t respond here until an administrator approves this chat (admin: /approve).';
                    await sendReply(body, notice);
                    accessService.markNotified(body.conversation.id);
                }
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

            // Admin commands work everywhere, including unapproved group chats
            if (senderId && accessService.isAdmin(senderId)) {
                const handled = await handleAdminCommand(body);
                if (handled) return;
            }

            // GC approval gate: stay silent in unapproved group chats
            if (isGroupChat && !accessService.isApproved(body.conversation.id)) {
                logger.info(`🚫 Ignored message in unapproved group chat ${body.conversation.id}`);
                return;
            }

            // Check if bot was mentioned
            const isMentioned = checkIfBotMentioned(body);
            const isEmulator = body.channelId === 'emulator' || body.channelId === 'test';

            // For emulator: allow all messages (for testing)
            // For Teams: only respond when mentioned
            if (!isEmulator && !isMentioned) {
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

            // Allowlist: only configured users may trigger Ami (admins always allowed)
            if (!accessService.isAllowedUser(body.from.id)) {
                logger.info(`🚫 User ${body.from.id} not allowed, ignoring message`);
                return;
            }

            // Handle empty text
            if (!body.text || body.text.trim() === '') {
                logger.warn('⚠️ Empty message received');
                const prompt = '👋 How can I help you today? Type "hello" to start.';
                await sendReply(body, prompt);
                return;
            }

            // Process the message
            const responseText = await agent.handleMessage(body);

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

    const match = text.match(/^\/(allow|disallow|allowlist|addadmin|removeadmin|admins|approve|restart)\b(.*)$/i);
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
            await sendReply(activity, '🔄 Soft restart complete. Sessions cleared, flows and access lists reloaded.');
            return true;

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
    const reply = {
        type: 'message',
        from: { id: originalActivity.recipient.id, name: originalActivity.recipient.name },
        conversation: { id: originalActivity.conversation.id },
        recipient: { id: originalActivity.from.id, name: originalActivity.from.name },
        text: text,
        replyToId: originalActivity.id,
    };

    const serviceUrl = originalActivity.serviceUrl;
    const conversationId = originalActivity.conversation.id;

    // The endpoint for posting the reply is serviceUrl + /v3/conversations/{conversationId}/activities
    const replyUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities`;

    try {
        logger.info('📤 Sending reply:', {
            url: replyUrl,
            text: (text || '').substring(0, 50) + '...'
        });

        // We don't have auth set up, so we send without a token.
        // This is fine for the emulator but will require auth for real channels.
        await axios.post(replyUrl, reply);

    } catch (error: any) {
        logger.error('❌ Error sending reply:', error.response?.data || error.message);
    }
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