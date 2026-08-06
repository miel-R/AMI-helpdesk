export class Metrics {
    public totalMessages = 0;
    public totalErrors = 0;
    public totalTickets = 0;
    public responseTimes: number[] = [];
    public activeUsers = new Set<string>();
    private startTime = Date.now();

    incrementMessages(): void {
        this.totalMessages++;
    }

    incrementErrors(): void {
        this.totalErrors++;
    }

    incrementTickets(): void {
        this.totalTickets++;
    }

    trackUser(userId: string): void {
        this.activeUsers.add(userId);
    }

    trackResponseTime(time: number): void {
        this.responseTimes.push(time);
        if (this.responseTimes.length > 1000) {
            this.responseTimes.shift();
        }
    }

    getAverageResponseTime(): number {
        if (this.responseTimes.length === 0) return 0;
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.responseTimes.length);
    }

    getStats() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            uptime: `${Math.floor(uptime / 60)}m ${uptime % 60}s`,
            totalMessages: this.totalMessages,
            totalErrors: this.totalErrors,
            totalTickets: this.totalTickets,
            activeUsers: this.activeUsers.size,
            averageResponseTime: `${this.getAverageResponseTime()}ms`,
            timestamp: new Date().toISOString()
        };
    }
}

export const metrics = new Metrics();