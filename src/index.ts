import { app } from './app';
import { config } from './config/config';
import { logger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const hasNodemonConfig = fs.existsSync(path.join(process.cwd(), 'nodemon.json'));

logger.info(`📁 CWD: ${process.cwd()}`);
logger.info(`📁 Upload dir: ${config.uploadDir}`);
logger.info(
    hasNodemonConfig
        ? '📁 nodemon.json present — nodemon watches src only'
        : '⚠️ nodemon.json MISSING — nodemon watches every file change in the project tree'
);

const server = app.listen(config.port, () => {
    logger.success(`🚀 ${config.companyName} Help Desk - Ami`);
    logger.success(`📍 Running on http://localhost:${config.port}`);
    logger.success(`📋 Departments: ${config.departments.join(', ')}`);
    logger.success('⚡ Capacity: 100 users in 4 hours');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('🛑 Shutting down gracefully...');
    server.close(() => {
        logger.info('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('🛑 Shutting down gracefully...');
    server.close(() => {
        logger.info('✅ Server closed');
        process.exit(0);
    });
});

export { server };