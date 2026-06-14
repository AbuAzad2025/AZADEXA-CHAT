import assert from "node:assert/strict";
import { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { errorHandler } from "./errorHandler";
import { AuthenticatedRequest, createAuthenticate, requireRole } from "./auth";

const now = new Date("2026-06-14T12:00:00.000Z");
const user = {
  id: "cmqd06xfa0000cn13o3jjs001",
  email: "alice@example.com",
  username: "alice",
  role: "USER",
  status: "ONLINE",
};

let session:
  | {
      id: string;
      userId: string;
      token: string;
      expiresAt: Date;
    }
  | undefined;

const fakePrisma = {
  session: {
    findFirst: async ({
      where,
    }: {
      where: {
        token: string;
        userId: string;
        expiresAt: { gt: Date };
      };
    }) => {
      if (
        session?.token === where.token &&
        session.userId === where.userId &&
        session.expiresAt > where.expiresAt.gt
      ) {
        return { id: session.id };
      }
      return null;
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === user.id ? user : null,
  },
} as unknown as PrismaClient;

const authenticate = createAuthenticate({
  prisma: fakePrisma,
  verifyAccessToken: (token) => {
    if (token === "invalid-token") throw new Error("Invalid token");
    return { userId: user.id };
  },
  now: () => now,
});

const app = express();
app.get("/protected", authenticate, (req, res) => {
  res.json({
    success: true,
    data: { user: (req as AuthenticatedRequest).user },
  });
});
app.get("/admin", authenticate, requireRole("ADMIN"), (_req, res) => {
  res.json({ success: true });
});
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const request = async (
  route: string,
  token?: string,
): Promise<{ status: number; body: { success: boolean; error?: string } }> => {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    status: response.status,
    body: (await response.json()) as { success: boolean; error?: string },
  };
};

before(() => {
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start auth middleware test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  session = {
    id: "session-1",
    userId: user.id,
    token: "valid-token",
    expiresAt: new Date(now.getTime() + 60_000),
  };
});

after(() => {
  server.close();
});

describe("authentication middleware", () => {
  it("rejects missing and invalid access tokens", async () => {
    const missing = await request("/protected");
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, "Authentication required");

    const invalid = await request("/protected", "invalid-token");
    assert.equal(invalid.status, 401);
    assert.equal(invalid.body.error, "Invalid or expired access token");
  });

  it("rejects revoked and expired database sessions", async () => {
    session = undefined;
    const revoked = await request("/protected", "valid-token");
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.error, "Session expired");

    session = {
      id: "session-1",
      userId: user.id,
      token: "valid-token",
      expiresAt: new Date(now.getTime() - 1),
    };
    const expired = await request("/protected", "valid-token");
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error, "Session expired");
  });

  it("attaches the active user and enforces roles", async () => {
    const protectedResponse = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(protectedResponse.status, 200);
    const body = (await protectedResponse.json()) as {
      data: { user: typeof user };
    };
    assert.equal(body.data.user.username, user.username);

    const forbidden = await request("/admin", "valid-token");
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "Forbidden: insufficient permissions");
  });
});
