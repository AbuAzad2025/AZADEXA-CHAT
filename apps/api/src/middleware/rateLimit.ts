import rateLimit from "express-rate-limit";
import { AppError } from "./errorHandler";

export const MESSAGE_RATE_LIMIT = 50;
export const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
export const MESSAGE_RATE_LIMIT_ERROR =
  "Message rate limit exceeded. Max 50 messages per minute.";

export const rateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, _next, options) => {
    throw new AppError(
      `Too many requests, please try again later.`,
      options.statusCode || 429,
    );
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  handler: (_req, _res, _next, options) => {
    throw new AppError(
      `Too many login attempts, please try again after 15 minutes.`,
      options.statusCode || 429,
    );
  },
});

interface MessageBucket {
  tokens: number;
  updatedAt: number;
}

interface MessageRateLimiterOptions {
  capacity?: number;
  windowMs?: number;
  now?: () => number;
}

export type ConsumeMessageQuota = (userId: string) => void;

export class MessageRateLimiter {
  private readonly buckets = new Map<string, MessageBucket>();
  private readonly refillPerMillisecond: number;
  private operations = 0;

  constructor(private readonly options: MessageRateLimiterOptions = {}) {
    this.refillPerMillisecond = this.capacity / this.windowMs;
  }

  private get capacity() {
    return this.options.capacity ?? MESSAGE_RATE_LIMIT;
  }

  private get windowMs() {
    return this.options.windowMs ?? MESSAGE_RATE_WINDOW_MS;
  }

  private get now() {
    return this.options.now ?? Date.now;
  }

  consume(userId: string): void {
    const now = this.now();
    const existing = this.buckets.get(userId);
    const elapsed = existing ? Math.max(0, now - existing.updatedAt) : 0;
    const availableTokens = existing
      ? Math.min(
          this.capacity,
          existing.tokens + elapsed * this.refillPerMillisecond,
        )
      : this.capacity;

    if (availableTokens < 1) {
      this.buckets.set(userId, { tokens: availableTokens, updatedAt: now });
      throw new AppError(MESSAGE_RATE_LIMIT_ERROR, 429);
    }

    this.buckets.set(userId, {
      tokens: availableTokens - 1,
      updatedAt: now,
    });
    this.operations += 1;
    if (this.operations % 1000 === 0) this.removeInactiveBuckets(now);
  }

  private removeInactiveBuckets(now: number): void {
    for (const [userId, bucket] of this.buckets) {
      if (now - bucket.updatedAt >= this.windowMs) {
        this.buckets.delete(userId);
      }
    }
  }
}

export const messageRateLimiter = new MessageRateLimiter();
export const consumeMessageQuota: ConsumeMessageQuota = (userId) =>
  messageRateLimiter.consume(userId);
