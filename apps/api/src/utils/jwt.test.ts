import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { validateJwtConfiguration } from "./jwt";

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;

const restoreEnvironmentValue = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

afterEach(() => {
  restoreEnvironmentValue("NODE_ENV", originalNodeEnv);
  restoreEnvironmentValue("JWT_SECRET", originalJwtSecret);
  restoreEnvironmentValue("JWT_REFRESH_SECRET", originalRefreshSecret);
});

describe("JWT configuration", () => {
  it("rejects missing secrets in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    assert.throws(
      () => validateJwtConfiguration(),
      /JWT_SECRET must be configured in production/,
    );
  });

  it("accepts configured production secrets", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "production-access-secret";
    process.env.JWT_REFRESH_SECRET = "production-refresh-secret";

    assert.doesNotThrow(() => validateJwtConfiguration());
  });
});
