import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { accessService } from './access.service';
import { getBotToken } from './auth.service';
import { logger } from '../utils/logger';

const STATE_FILE = path.resolve(process.cwd(), 'alert-config.json');

type AlertMode = 'both' | 'gc' | '1to1';

interface AlertState {
    enabled: boolean;
    mode: AlertMode;
    adminGC: { conversationId?: string; conversation?: any; serviceUrl: string; from?: any; recipient?: any } | null;
    dedupeMinutes: number;
}

export interface AlertIssueInfo {
    reporterName?: string;
    reporterId: string;
    message: string;
}

export class AlertService {
    private state: AlertState = {
        enabled: true,
        mode: 'both',
        adminGC: null,
        dedupeMinutes: 10
    };

    // adminId -> activity ref (1:1/any conversation the admin was seen in)
    private adminRefs: Map<string, any> = new Map();
    // reporterId -> last alert timestamp (dedupe)
    private lastAlert: Map<string, number> = new Map();

    constructor() {
        this.reload();
    }

    reload(): void {
        this.adminRefs.clear();
        this.lastAlert.clear();
        if (fs.existsSync(STATE_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as Partial<AlertState>;
                this.state = { ...this.state, ...data };
                logger.info('Loaded alert config from alert-config.json');
            } catch (error) {
                logger.error('Could not load alert-config.json:', error);
            }
        }
    }

    // ── Configuration ──────────────────────────────────────────────────────────

    setEnabled(enabled: boolean): void {
        this.state.enabled = enabled;
        this.persist();
    }

    setMode(mode: AlertMode): void {
        this.state.mode = mode;
        this.persist();
    }

    isEnabled(): boolean {
        return this.state.enabled;
    }

    getMode(): AlertMode {
        return this.state.mode;
    }

    registerAdminGC(activity: any): void {
        const conversationId = activity.conversation?.id;
        if (!conversationId || !activity.serviceUrl) return;
        this.state.adminGC = {
            conversation: activity.conversation,
            conversationId,
            serviceUrl: activity.serviceUrl,
            from: activity.from,
            recipient: activity.recipient
        };
        this.persist();
        logger.info(`🏢 Admin alert channel registered: ${conversationId}`);
    }

    setDedupeMinutes(minutes: number): void {
        this.state.dedupeMinutes = Math.max(0, minutes);
        this.persist();
    }

    getStatus(): string {
        const admins = accessService.listAdmins();
        const gcId = this.state.adminGC?.conversationId || this.state.adminGC?.conversation?.id;
        const gc = gcId ? `${gcId}` : '(not registered — use /alert gcon)';
        return [
            '🔔 **Alert config**',
            `• Enabled: ${this.state.enabled ? 'ON' : 'OFF'}`,
            `• Mode: ${this.state.mode}`,
            `• Admin GC: ${gc}`,
            `• Admin 1:1 known: ${admins.filter(id => this.adminRefs.has(id)).length}/${admins.length}`,
            `• Dedupe: ${this.state.dedupeMinutes} min`
        ].join('\n');
    }

    // ── Conversation memory ────────────────────────────────────────────────────

    /** Remember the last activity for an admin so alerts can be 1:1'd privately. */
    rememberConversation(userId: string, activity: any): void {
        if (accessService.isAdmin(userId) && activity?.conversation?.id) {
            this.adminRefs.set(userId, activity);
        }
    }

    // ── Alerting ───────────────────────────────────────────────────────────────

    async notifyIssue(info: AlertIssueInfo): Promise<void> {
        if (!this.state.enabled) {
            logger.info('🔕 Alerts disabled — skipping issue alert.');
            return;
        }

        const now = Date.now();
        const last = this.lastAlert.get(info.reporterId) || 0;
        const span = (this.state.dedupeMinutes || 10) * 60 * 1000;
        if (now - last < span) {
            logger.info(`🔕 Dedupe — skipping alert for ${info.reporterId}`);
            return;
        }
        this.lastAlert.set(info.reporterId, now);

        const text = this.buildAlertText(info);

        if (this.state.mode === 'both' || this.state.mode === 'gc') {
            if (this.state.adminGC?.conversationId) {
                await this.postAlert(this.state.adminGC, text);
            } else {
                logger.warn('⚠️ No admin GC registered — alert to GC skipped (use /alert gcon).');
            }
        }

        if (this.state.mode === 'both' || this.state.mode === '1to1') {
            for (const adminId of accessService.listAdmins()) {
                const ref = this.adminRefs.get(adminId);
                if (ref) {
                    await this.postAlert(ref, text);
                } else {
                    logger.info(`ℹ️ No registered conversation for admin ${adminId} — 1:1 alert skipped.`);
                }
            }
        }
    }

    /** /alert test — send a sample alert to all configured destinations. */
    async testAlert(): Promise<string> {
        const info: AlertIssueInfo = { reporterName: '(test)', reporterId: 'test-user', message: 'This is a test alert.' };
        const text = `🧪 **TEST ALERT**\n\n${this.buildAlertText(info)}`;
        let sent = 0;

        if (this.state.mode === 'both' || this.state.mode === 'gc') {
            if (this.state.adminGC?.conversationId) {
                await this.postAlert(this.state.adminGC, text);
                sent++;
            }
        }
        if (this.state.mode === 'both' || this.state.mode === '1to1') {
            for (const adminId of accessService.listAdmins()) {
                if (this.adminRefs.has(adminId)) {
                    await this.postAlert(this.adminRefs.get(adminId), text);
                    sent++;
                }
            }
        }
        return `🧪 Sent to ${sent} destination(s).` + (!this.state.adminGC ? '\n⚠️ No admin GC registered — use /alert gcon.' : '');
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private buildAlertText(info: AlertIssueInfo): string {
        return [
            '⚠️ *Help Desk Alert*',
            `👤 Reporter: ${info.reporterName || 'Unknown'} (${info.reporterId})`,
            `💬 Message: "${info.message}"`,
            `🕐 ${new Date().toLocaleString()}`,
            '_An admin should reach out to this person personally._'
        ].join('\n');
    }

    private async postAlert(ref: { conversationId?: string; conversation?: any; serviceUrl?: string; from?: any; recipient?: any }, text: string): Promise<void> {
        const conversationId = ref?.conversationId || ref?.conversation?.id;
        const serviceUrl = ref?.serviceUrl;
        if (!conversationId || !serviceUrl) return;

        const reply: any = {
            type: 'message',
            textFormat: 'markdown',
            from: { id: ref?.recipient?.id, name: ref?.recipient?.name },
            conversation: { id: conversationId },
            recipient: { id: ref?.from?.id, name: ref?.from?.name },
            text
        };

        const url = `${serviceUrl}/v3/conversations/${conversationId}/activities`;
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const token = await getBotToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
            await axios.post(url, reply, { headers });
            logger.info(`📣 Alert posted to ${conversationId}`);
        } catch (error: any) {
            logger.error('❌ Failed to post alert:', error?.response?.data || error?.message);
        }
    }

    private persist(): void {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch (error) {
            logger.error('Could not persist alert-config.json:', error);
        }
    }
}

export const alertService = new AlertService();
