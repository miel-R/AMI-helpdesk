import dotenv from 'dotenv';
import path from 'path';

// Load env files in priority order — user secrets last so they override non-secret values
dotenv.config({ path: path.resolve(process.cwd(), '.env.dev') });
dotenv.config({ path: path.resolve(process.cwd(), 'env/.env.dev') });
dotenv.config({ path: path.resolve(process.cwd(), 'env/.env.dev.user') }); // ← SECRET_ keys live here
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function splitCsv(value: string | undefined): string[] {
    return (value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function splitCsvLower(value: string | undefined): string[] {
    return splitCsv(value).map(s => s.toLowerCase());
}

const DEFAULT_SENSITIVE_TOPICS = [
    // Compensation
    'sweldo', 'sahod', 'salary', 'compensation', 'pay grade', 'pay rate', 'salary ng',
    // Pricing / costs
    'pricing', 'presyo', 'cost structure', 'markup', 'margin', 'internal price',
    // Employee personal data
    'personal data', 'personal info', 'employee record', 'sss number', 'health record',
    'medical info', 'home address',
    // Credentials / secrets
    'api key', 'secret key', 'access key', 'client secret', 'database password', 'credentials ng',
    // Unannounced / legal
    'unannounced', 'merger', 'acquisition', 'layoff', 'restructuring', 'confidential project'
];


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

    // Reply control — first-run seeds only; runtime changes live in access-control.json
    allowedUserIds: splitCsv(process.env.ALLOWED_USER_IDS),
    adminUserIds: splitCsv(process.env.ADMIN_USER_IDS),
    approvedConversationIds: splitCsv(process.env.APPROVED_CONVERSATION_IDS),

    // Confidentiality — built-in defaults + custom additions from SENSITIVE_TOPICS
    sensitiveTopics: [
        ...DEFAULT_SENSITIVE_TOPICS,
        ...splitCsvLower(process.env.SENSITIVE_TOPICS)
    ],

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