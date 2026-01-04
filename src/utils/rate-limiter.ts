
export class AdvancedRateLimiter {
    private buckets: Map<string, TokenBucket> = new Map();
  
    async checkLimit(
      key: string,
      maxTokens: number = 100,
      refillRate: number = 10
    ): Promise<boolean> {
      let bucket = this.buckets.get(key);
  
      if (!bucket) {
        bucket = new TokenBucket(maxTokens, refillRate);
        this.buckets.set(key, bucket);
      }
  
      return bucket.consume(1);
    }
  
    async consumeTokens(key: string, tokens: number): Promise<boolean> {
      const bucket = this.buckets.get(key);
      if (!bucket) return false;
      
      return bucket.consume(tokens);
    }
  
    reset(key: string): void {
      this.buckets.delete(key);
    }
  
    resetAll(): void {
      this.buckets.clear();
    }
  }
  
  class TokenBucket {
    private tokens: number;
    private lastRefill: number;
  
    constructor(
      private maxTokens: number,
      private refillRate: number
    ) {
      this.tokens = maxTokens;
      this.lastRefill = Date.now();
    }
  
    consume(tokens: number): boolean {
      this.refill();
  
      if (this.tokens >= tokens) {
        this.tokens -= tokens;
        return true;
      }
  
      return false;
    }
  
    private refill(): void {
      const now = Date.now();
      const timePassed = (now - this.lastRefill) / 1000;
      const tokensToAdd = timePassed * this.refillRate;
  
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
  
  export const rateLimiter = new AdvancedRateLimiter();
      