type LogLevel = 'info' | 'warn' | 'error' | 'success';

export class Logger {
    private colors = {
        info: '\x1b[36m',
        warn: '\x1b[33m',
        error: '\x1b[31m',
        success: '\x1b[32m',
        reset: '\x1b[0m'
    };

    private log(level: LogLevel, message: string, data?: any): void {
        const timestamp = new Date().toISOString();
        const color = this.colors[level];
        const prefix = `[${timestamp}] ${color}${level.toUpperCase()}${this.colors.reset}`;

        console.log(`${prefix} ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }

    info(message: string, data?: any): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: any): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: any): void {
        this.log('error', message, data);
    }

    success(message: string, data?: any): void {
        this.log('success', message, data);
    }
}

export const logger = new Logger();