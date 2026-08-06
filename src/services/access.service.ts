import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const STATE_FILE = path.resolve(process.cwd(), 'access-control.json');

interface AccessState {
    allowedUserIds: string[];
    adminUserIds: string[];
    approvedConversations: string[];
    notified: string[];
}

export class AccessService {
    private allowed: Set<string>;
    private admins: Set<string>;
    private approved: Set<string>;
    private notified: Set<string>;

    constructor() {
        this.allowed = new Set();
        this.admins = new Set();
        this.approved = new Set();
        this.notified = new Set();
        this.reload();
    }

    reload(): void {
        this.allowed.clear();
        this.admins.clear();
        this.approved.clear();
        this.notified.clear();

        if (fs.existsSync(STATE_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as AccessState;
                for (const id of (data.allowedUserIds || [])) this.allowed.add(id);
                for (const id of (data.adminUserIds || [])) this.admins.add(id);
                for (const id of (data.approvedConversations || [])) this.approved.add(id);
                for (const id of (data.notified || [])) this.notified.add(id);
                logger.info('Loaded access control from access-control.json');
                return;
            } catch (error) {
                logger.error('Could not load access-control.json:', error);
            }
        }

        // First run: seed from env vars, then the JSON file becomes the source of truth
        for (const id of config.allowedUserIds) this.allowed.add(id);
        for (const id of config.adminUserIds) this.admins.add(id);
        for (const id of config.approvedConversationIds) this.approved.add(id);
        this.persist();
        logger.info('Seeded access control from env (first run)');
    }

    private persist(): void {
        try {
            const state: AccessState = {
                allowedUserIds: [...this.allowed],
                adminUserIds: [...this.admins],
                approvedConversations: [...this.approved],
                notified: [...this.notified]
            };
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        } catch (error) {
            logger.error('Could not persist access-control.json:', error);
        }
    }

    // Default-deny: empty lists mean nobody is allowed (admins always allowed)
    isAllowedUser(userId: string): boolean {
        return this.allowed.has(userId) || this.admins.has(userId);
    }

    isAdmin(userId: string): boolean {
        return this.admins.has(userId);
    }

    allowUser(userId: string): void {
        this.allowed.add(userId);
        this.persist();
    }

    disallowUser(userId: string): boolean {
        if (this.admins.has(userId)) return false;
        const removed = this.allowed.delete(userId);
        if (removed) this.persist();
        return removed;
    }

    listAllowed(): string[] {
        return [...this.allowed];
    }

    addAdmin(userId: string): void {
        this.admins.add(userId);
        this.allowed.add(userId);
        this.persist();
    }

    removeAdmin(userId: string): void {
        this.admins.delete(userId);
        this.persist();
    }

    listAdmins(): string[] {
        return [...this.admins];
    }

    isApproved(conversationId: string): boolean {
        return this.approved.has(conversationId);
    }

    isNotified(conversationId: string): boolean {
        return this.notified.has(conversationId);
    }

    markNotified(conversationId: string): void {
        this.notified.add(conversationId);
        this.persist();
    }

    approve(conversationId: string): void {
        this.approved.add(conversationId);
        this.persist();
        logger.success(`Approved conversation ${conversationId}`);
    }
}

export const accessService = new AccessService();
