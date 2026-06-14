import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "./errorHandler";
import { MESSAGE_RATE_LIMIT_ERROR, MessageRateLimiter } from "./rateLimit";

describe("per-user message rate limiter", () => {
  it("allows 50 immediate messages and rejects the next one", () => {
    const limiter = new MessageRateLimiter({ now: () => 0 });

    for (let count = 0; count < 50; count += 1) {
      assert.doesNotThrow(() => limiter.consume("alice"));
    }

    assert.throws(
      () => limiter.consume("alice"),
      (error) =>
        error instanceof AppError &&
        error.statusCode === 429 &&
        error.message === MESSAGE_RATE_LIMIT_ERROR,
    );
  });

  it("refills quota over time and isolates users", () => {
    let now = 0;
    const limiter = new MessageRateLimiter({
      capacity: 2,
      windowMs: 1000,
      now: () => now,
    });

    limiter.consume("alice");
    limiter.consume("alice");
    assert.throws(() => limiter.consume("alice"), AppError);
    assert.doesNotThrow(() => limiter.consume("bob"));

    now = 500;
    assert.doesNotThrow(() => limiter.consume("alice"));
    assert.throws(() => limiter.consume("alice"), AppError);

    now = 1000;
    assert.doesNotThrow(() => limiter.consume("alice"));
  });
});
