import { config } from "../config/config";
import { logger } from "../utils/logger";

interface QueueItem<T = any> {
    context: T;
    processFn: (context: T) => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timestamp: number;
}

export class QueueService {
    private queue: QueueItem[] = [];
    private processing = false;
    private currentProcessing = 0;
    private maxConcurrent = config.maxConcurrent;

    isBusy(): boolean {
        return this.currentProcessing >= this.maxConcurrent;
    }

    async addToQueue<T>(context: T, processFn: (context: T) => Promise<any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const index = this.queue.findIndex((item) => item.context === context);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    reject(new Error("Queue timeout"));
                }
            }, config.queueTimeout);

            this.queue.push({
                context,
                processFn,
                resolve: (value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                },
                timestamp: Date.now(),
            });

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        if (this.queue.length === 0) return;
        if (this.currentProcessing >= this.maxConcurrent) return;

        this.processing = true;

        while (this.queue.length > 0 && this.currentProcessing < this.maxConcurrent) {
            const item = this.queue.shift()!;
            this.currentProcessing++;

            logger.info(
                `Processing queue item. ${this.currentProcessing}/${this.maxConcurrent} concurrent`
            );

            try {
                const result = await item.processFn(item.context);
                item.resolve(result);
            } catch (error) {
                item.reject(error);
                logger.error("Queue processing error:", error);
            } finally {
                this.currentProcessing--;
            }
        }

        this.processing = false;

        if (this.queue.length > 0) {
            this.processQueue();
        }
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    clearQueue(): void {
        this.queue = [];
    }
}

export const queueService = new QueueService();

