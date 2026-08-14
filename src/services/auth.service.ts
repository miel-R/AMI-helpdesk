import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// ── Outgoing token cache ───────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Acquires a Bot Framework access token via the Entra client-credentials flow
 * (BOT_ID / BOT_PASSWORD). Returns null when no credentials are configured
 * (emulator / local testing without .localConfigs).
 */
export async function getBotToken(): Promise<string | null> {
    if (!config.botId || !config.botPassword) return null;

    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 60 * 1000) {
        return cachedToken.value;
    }

    try {
        const res = await axios.post(
            'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
            new URLSearchParams({
                client_id: config.botId,
                client_secret: config.botPassword,
                scope: 'https://api.botframework.com/.default',
                grant_type: 'client_credentials'
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const data = res.data as { access_token?: string; expires_in?: number };
        if (!data.access_token) return null;

        cachedToken = {
            value: data.access_token,
            expiresAt: now + (data.expires_in || 3600) * 1000
        };
        logger.info('🔑 Bot token acquired (cached)');
        return cachedToken.value;
    } catch (error: any) {
        logger.error('❌ Failed to acquire bot token:', error?.response?.data || error?.message);
        return null;
    }
}

/**
 * Validates an incoming Bot Framework activity (JWT bearer token, issuer,
 * audience, expiry and service URL) using the standard Bot Framework claims
 * validation. Returns true when authenticated, false to reject.
 *
 * Skips validation entirely when the bot has no credentials configured
 * (emulator / local testing), or when the caller already identified the
 * channel as emulator/test.
 */
export async function authenticateIncomingRequest(headers: Record<string, any>, body: any, isEmulator: boolean): Promise<boolean> {
    if (isEmulator) return true;
    if (!config.botId) {
        logger.warn('⚠️ No BOT_ID configured — skipping incoming token validation.');
        return true;
    }
    if (!headers.authorization) {
        logger.warn('🚫 Rejected activity: missing Authorization header.');
        return false;
    }

    try {
        const { JwtTokenValidation, SimpleCredentialProvider } = await import('botframework-connector');
        const credentialProvider = new SimpleCredentialProvider(config.botId, config.botPassword || '');
        await JwtTokenValidation.authenticateRequest(
            body,
            String(headers.authorization),
            credentialProvider,
            '' // public cloud channel service (empty = standard Bot Framework)
        );
        return true;
    } catch (error: any) {
        logger.error('🚫 Rejected activity: invalid token.', error?.message || error);
        return false;
    }
}
