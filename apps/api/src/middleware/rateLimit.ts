import rateLimit from "express-rate-limit";
import { AppError } from "./errorHandler";

export const rateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, _next, options) => {
    throw new AppError(`Too many requests, please try again later.`, options.statusCode || 429);
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  handler: (_req, _res, _next, options) => {
    throw new AppError(`Too many login attempts, please try again after 15 minutes.`, options.statusCode || 429);
  },
});

export const messageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  handler: (_req, _res, _next, options) => {
    throw new AppError(`Message rate limit exceeded. Max 50 messages per minute.`, options.statusCode || 429);
  },
});
