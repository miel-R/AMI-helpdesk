import NodeCache from 'node-cache';
import { config } from '../config/config';

export class MemoryCache {
    private cache: NodeCache;

    constructor() {
        this.cache = new NodeCache({
            stdTTL: config.cacheTTL,
            maxKeys: config.maxCacheSize,
            checkperiod: 120
        });
    }

    get<T>(key: string): T | undefined {
        return this.cache.get<T>(key);
    }

    set<T>(key: string, value: T, ttl: number = config.cacheTTL): boolean {
        return this.cache.set(key, value, ttl);
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    del(key: string): number {
        return this.cache.del(key);
    }

    flush(): void {
        this.cache.flushAll();
    }

    keys(): string[] {
        return this.cache.keys();
    }
}

export const cache = new MemoryCache();