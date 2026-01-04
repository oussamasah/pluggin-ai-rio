
export class CacheManager<T = any> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private defaultTTL: number = 300000; // 5 minutes
  
    set(key: string, value: T, ttl?: number): void {
      const expiresAt = Date.now() + (ttl || this.defaultTTL);
      
      this.cache.set(key, {
        value,
        expiresAt,
        hits: 0,
      });
    }
  
    get(key: string): T | null {
      const entry = this.cache.get(key);
  
      if (!entry) return null;
  
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        return null;
      }
  
      entry.hits++;
      return entry.value;
    }
  
    has(key: string): boolean {
      return this.get(key) !== null;
    }
  
    delete(key: string): boolean {
      return this.cache.delete(key);
    }
  
    clear(): void {
      this.cache.clear();
    }
  
    getStats(): CacheStats {
      let totalHits = 0;
      let validEntries = 0;
      const now = Date.now();
  
      this.cache.forEach(entry => {
        if (now <= entry.expiresAt) {
          validEntries++;
          totalHits += entry.hits;
        }
      });
  
      return {
        size: this.cache.size,
        validEntries,
        totalHits,
        avgHits: validEntries > 0 ? totalHits / validEntries : 0,
      };
    }
  
    cleanup(): void {
      const now = Date.now();
      const keysToDelete: string[] = [];
  
      this.cache.forEach((entry, key) => {
        if (now > entry.expiresAt) {
          keysToDelete.push(key);
        }
      });
  
      keysToDelete.forEach(key => this.cache.delete(key));
    }
  }
  
  interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    hits: number;
  }
  
  interface CacheStats {
    size: number;
    validEntries: number;
    totalHits: number;
    avgHits: number;
  }
  
  export const cacheManager = new CacheManager();
  