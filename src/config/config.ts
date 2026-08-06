import dotenv from 'dotenv';
import path from 'path';

// Load env files in priority order — user secrets last so they override non-secret values
dotenv.config({ path: path.resolve(process.cwd(), '.env.dev') });
dotenv.config({ path: path.resolve(process.cwd(), 'env/.env.dev') });
dotenv.config({ path: path.resolve(process.cwd(), 'env/.env.dev.user') }); // ← SECRET_ keys live here
dotenv.config({ path: path.resolve(process.cwd(), '.env') });


export const config = {
    // General
    companyName: process.env.COMPANY_NAME || 'Amertron Corporation',
    port: parseInt(process.env.PORT || '3978', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // AI - Provider selection
    // Set AI_PROVIDER to 'gemini', 'openai', or 'azure' to force a specific provider.
    // If not set, auto-detects based on which API key is present.
    aiProvider: (process.env.AI_PROVIDER || 'auto') as 'gemini' | 'openai' | 'azure' | 'auto',

    // AI - Gemini
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.SECRET_GEMINI_API_KEY || '',
    geminiModelName: process.env.GEMINI_MODEL_NAME || 'gemini-3.5-flash-lite',

    // AI - Azure OpenAI
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    azureOpenAIKey: process.env.AZURE_OPENAI_KEY || process.env.SECRET_AZURE_OPENAI_KEY || '',
    azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',

    // AI - OpenAI (ChatGPT)
    openAIApiKey: process.env.OPENAI_API_KEY || process.env.SECRET_OPENAI_API_KEY || '',
    openAIModel: process.env.OPENAI_MODEL || 'gpt-4o',

    // Image handling
    maxImageSizeMB: parseInt(process.env.MAX_IMAGE_SIZE_MB || '10', 10),
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
    uploadDir: process.env.UPLOAD_DIR || './uploads',

    // Departments
    departments: ['it', 'engineering', 'hr', 'manufacturing', 'finance'],

    // Performance
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '10', 10),
    queueTimeout: parseInt(process.env.QUEUE_TIMEOUT || '30000', 10),
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '1800000', 10),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    maxRequestsPerWindow: parseInt(process.env.MAX_REQUESTS_PER_WINDOW || '10', 10),

    // Cache
    cacheTTL: parseInt(process.env.CACHE_TTL || '3600', 10),
    maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE || '1000', 10),

    // Ticket
    ticketPrefix: process.env.TICKET_PREFIX || 'AMR',
    notifyOnTicket: process.env.NOTIFY_ON_TICKET === 'true',
};

export type Config = typeof config;