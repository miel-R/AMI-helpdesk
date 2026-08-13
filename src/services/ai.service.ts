import axios from 'axios';
import { config } from '../config/config';
import { cache } from '../cache/memory.cache';
import { logger } from '../utils/logger';

// ── Shared Types ─────────────────────────────────────────────────────────────

export interface HistoryItem {
    role: 'user' | 'model';
    content: string;
}

export interface ImageData {
    mimeType: string;
    base64Data: string;
    fileName?: string;
}

type Provider = 'gemini' | 'azure' | 'openai' | 'none';

// ── Internal Response Shapes ──────────────────────────────────────────────────

interface GeminiResponse {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
    }>;
}

interface OpenAIResponse {
    choices?: Array<{
        message?: { content?: string };
    }>;
}

// ── Unified AI Service ────────────────────────────────────────────────────────

export class AIService {
    private activeProvider: Provider;

    constructor() {
        this.activeProvider = this.resolveProvider();
        if (this.activeProvider !== 'none') {
            logger.info(`🤖 AI Provider: ${this.activeProvider.toUpperCase()}`);
        } else {
            logger.warn('⚠️ No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in your .env file.');
        }
    }

    /**
     * Resolves which AI provider to use.
     * Priority:
     *   1. AI_PROVIDER env variable (explicit override)
     *   2. Auto-detect by checking which API keys are present:
     *      Gemini → OpenAI → Azure OpenAI
     */
    private resolveProvider(): Provider {
        const manual = config.aiProvider;

        if (manual !== 'auto') {
            // Explicit provider set — validate key exists
            if (manual === 'gemini' && config.geminiApiKey) return 'gemini';
            if (manual === 'openai' && config.openAIApiKey) return 'openai';
            if (manual === 'azure' && config.azureOpenAIEndpoint && config.azureOpenAIKey) return 'azure';
            logger.warn(`⚠️ AI_PROVIDER="${manual}" set but required API key is missing. Falling back to auto-detect.`);
        }

        // Auto-detect fallback chain: Gemini → OpenAI → Azure
        if (config.geminiApiKey) return 'gemini';
        if (config.openAIApiKey) return 'openai';
        if (config.azureOpenAIEndpoint && config.azureOpenAIKey) return 'azure';

        return 'none';
    }

    getActiveProvider(): Provider {
        return this.activeProvider;
    }

    /**
     * Main AI call entry point — works with any configured provider.
     *
     * @param userMessage  The user's current message text
     * @param systemPrompt The system instruction / persona for the AI
     * @param history      Optional conversation history for multi-turn context
     * @param image        Optional image attachment data
     */
    async callAI(
        userMessage: string,
        systemPrompt: string,
        history?: HistoryItem[],
        image?: ImageData
    ): Promise<string> {
        if (this.activeProvider === 'none') {
            return '⚠️ No AI provider configured. Please set GEMINI_API_KEY or OPENAI_API_KEY in your env file.';
        }

        // Cache stateless (no-history) calls to reduce API usage.
        // Image calls are never cached (cache key holds no image reference).
        const isStateless = !history || history.length === 0;
        const cacheable = isStateless && !image;
        const cacheKey = `ai:${this.activeProvider}:${userMessage.substring(0, 100)}`;
        if (cacheable) {
            const cached = cache.get<string>(cacheKey);
            if (cached) {
                logger.info('✅ AI response served from cache');
                return cached;
            }
        }

        try {
            let response: string;

            switch (this.activeProvider) {
                case 'gemini':
                    response = await this.callGemini(userMessage, systemPrompt, history, image);
                    break;
                case 'openai':
                    response = await this.callOpenAI(userMessage, systemPrompt, history);
                    break;
                case 'azure':
                    response = await this.callAzureOpenAI(userMessage, systemPrompt, history);
                    break;
                default:
                    return '⚠️ No AI provider available.';
            }

            // Cache stateless responses
            if (cacheable && response && response.length > 10) {
                cache.set(cacheKey, response);
            }

            return response;
        } catch (error: any) {
            logger.error(`${this.activeProvider.toUpperCase()} AI Error:`, error?.message || error);
            return '⚠️ Error generating AI response. Please try again.';
        }
    }

    // ── Gemini ────────────────────────────────────────────────────────────────

    private async callGemini(
        userMessage: string,
        systemPrompt: string,
        history?: HistoryItem[],
        image?: ImageData
    ): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModelName}:generateContent?key=${config.geminiApiKey}`;

        interface GeminiPart {
            text?: string;
            inlineData?: { mimeType: string; data: string };
        }
        interface GeminiContent {
            role: 'user' | 'model';
            parts: GeminiPart[];
        }

        const contents: GeminiContent[] = (history || []).map(item => ({
            role: item.role,
            parts: [{ text: item.content }]
        }));

        // If no history passed, add the current message directly
        if (!history || history.length === 0) {
            const parts: GeminiPart[] = [{ text: userMessage || 'Help me.' }];
            if (image) {
                parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64Data } });
            }
            contents.push({ role: 'user', parts });
        } else if (image) {
            // Multi-turn history makes the model lose the attached image (reproduced
            // against the live API): collapse to just the current user turn + image.
            const lastUserText = [...(history || [])].reverse().find(i => i.role === 'user')?.content;
            const text = userMessage || lastUserText || 'Analyze this image and respond.';
            contents.length = 0;
            contents.push({
                role: 'user',
                parts: [
                    { text },
                    { inlineData: { mimeType: image.mimeType, data: image.base64Data } }
                ]
            });
        }

        const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        };

        const res = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const data = res.data as GeminiResponse;
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";
    }

    // ── OpenAI (ChatGPT) ──────────────────────────────────────────────────────

    private async callOpenAI(
        userMessage: string,
        systemPrompt: string,
        history?: HistoryItem[]
    ): Promise<string> {
        const messages: { role: string; content: string }[] = [
            { role: 'system', content: systemPrompt }
        ];

        // Add conversation history
        for (const item of history || []) {
            messages.push({
                role: item.role === 'model' ? 'assistant' : 'user',
                content: item.content
            });
        }

        // Add current message if not already in history
        if (!history || history.length === 0) {
            messages.push({ role: 'user', content: userMessage });
        }

        const res = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: config.openAIModel,
                messages,
                temperature: 0.7,
                max_tokens: 800
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.openAIApiKey}`
                }
            }
        );

        const data = res.data as OpenAIResponse;
        return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
    }

    // ── Azure OpenAI ──────────────────────────────────────────────────────────

    private async callAzureOpenAI(
        userMessage: string,
        systemPrompt: string,
        history?: HistoryItem[]
    ): Promise<string> {
        const messages: { role: string; content: string }[] = [
            { role: 'system', content: systemPrompt }
        ];

        for (const item of history || []) {
            messages.push({
                role: item.role === 'model' ? 'assistant' : 'user',
                content: item.content
            });
        }

        if (!history || history.length === 0) {
            messages.push({ role: 'user', content: userMessage });
        }

        const url = `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=2024-02-15-preview`;

        const res = await axios.post(
            url,
            {
                messages,
                temperature: 0.7,
                max_tokens: 800
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': config.azureOpenAIKey
                }
            }
        );

        const data = res.data as OpenAIResponse;
        return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
    }
}

export const aiService = new AIService();