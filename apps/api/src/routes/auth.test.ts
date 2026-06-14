import assert from "node:assert/strict";
import { Server } from "http";
import { after, before, beforeEach, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { errorHandler } from "../middleware/errorHandler";
import { createAuthRouter } from "./auth";

interface TestUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  language: string;
  birthDate?: Date;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
}

interface TestSession {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: Date;
}

interface TestApiResponse {
  success: boolean;
  error?: string;
  message?: string;
  data?: {
    user?: {
      id: string;
      email: string;
      username: string;
      role: UserRole;
      status?: UserStatus;
    };
    accessToken?: string;
    refreshToken?: string;
  };
}

let users: TestUser[] = [];
let sessions: TestSession[] = [];
let userSequence = 0;
let sessionSequence = 0;
const disconnectedSessions: string[] = [];

const fakePrisma = {
  user: {
    findFirst: async ({
      where,
    }: {
      where: { OR: Array<{ email?: string; username?: string }> };
    }) =>
      users.find((user) =>
        where.OR.some(
          (condition) =>
            condition.email === user.email ||
            condition.username === user.username,
        ),
      ) || null,
    findUnique: async ({ where }: { where: { email: string } }) =>
      users.find(({ email }) => email === where.email) || null,
    create: async ({
      data,
    }: {
      data: {
        email: string;
        username: string;
        passwordHash: string;
        language: string;
        birthDate?: Date;
      };
    }) => {
      userSequence += 1;
      const user: TestUser = {
        id: `cmqd06xfa0000cn13o3jjm8${String(userSequence).padStart(2, "0")}`,
        ...data,
        role: "USER",
        status: "OFFLINE",
        createdAt: new Date("2026-06-14T00:00:00.000Z"),
      };
      users.push(user);
      return user;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { status: UserStatus };
    }) => {
      const user = users.find(({ id }) => id === where.id);
      if (!user) throw new Error("Test user missing");
      user.status = data.status;
      return user;
    },
  },
  session: {
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        token: string;
        refreshToken: string;
        expiresAt: Date;
      };
    }) => {
      sessionSequence += 1;
      const session = {
        id: `session-${sessionSequence}`,
        ...data,
      };
      sessions.push(session);
      return session;
    },
    findFirst: async ({
      where,
    }: {
      where: {
        refreshToken: string;
        userId: string;
        expiresAt: { gt: Date };
      };
    }) =>
      sessions.find(
        (session) =>
          session.refreshToken === where.refreshToken &&
          session.userId === where.userId &&
          session.expiresAt > where.expiresAt.gt,
      ) || null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { token: string; refreshToken: string };
    }) => {
      const session = sessions.find(({ id }) => id === where.id);
      if (!session) throw new Error("Test session missing");
      Object.assign(session, data);
      return session;
    },
    findMany: async ({ where }: { where: { token: string } }) =>
      sessions
        .filter(({ token }) => token === where.token)
        .map(({ id }) => ({ id })),
    deleteMany: async ({ where }: { where: { token: string } }) => {
      const previousLength = sessions.length;
      sessions = sessions.filter(({ token }) => token !== where.token);
      return { count: previousLength - sessions.length };
    },
  },
} as unknown as PrismaClient;

const passThroughRateLimiter: RequestHandler = (_req, _res, next) => next();

const app = express();
app.use(express.json());
app.use(
  "/api/v1/auth",
  createAuthRouter({
    prisma: fakePrisma,
    loginRateLimiter: passThroughRateLimiter,
    disconnectSession: (sessionId) => disconnectedSessions.push(sessionId),
    hashPassword: async (password) => `hashed:${password}`,
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
  }),
);
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const apiRequest = async (
  route: string,
  options: {
    method?: string;
    body?: object;
    token?: string;
  } = {},
): Promise<{ status: number; body: TestApiResponse }> => {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: (await response.json()) as TestApiResponse,
  };
};

const validRegistration = {
  email: "alice@example.com",
  username: "alice",
  password: "StrongPass1!",
};

before(() => {
  process.env.JWT_SECRET = "auth-test-access-secret";
  process.env.JWT_REFRESH_SECRET = "auth-test-refresh-secret";
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start auth test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  users = [];
  sessions = [];
  userSequence = 0;
  sessionSequence = 0;
  disconnectedSessions.length = 0;
});

after(() => {
  server.close();
});

describe("auth API", () => {
  it("registers a user and rejects invalid or duplicate accounts", async () => {
    const invalid = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "not-an-email",
        username: "x",
        password: "weak",
      },
    });
    assert.equal(invalid.status, 400);

    const registered = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: validRegistration,
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data?.user?.username, "alice");
    assert.ok(registered.body.data?.accessToken);
    assert.ok(registered.body.data?.refreshToken);
    assert.equal(sessions.length, 1);

    const duplicate = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: validRegistration,
    });
    assert.equal(duplicate.status, 409);
  });

  it("logs in, rotates refresh tokens, invalidates the old token, and logs out", async () => {
    const registered = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: validRegistration,
    });
    const registrationToken = registered.body.data?.accessToken;
    assert.ok(registrationToken);

    const wrongPassword = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: { email: validRegistration.email, password: "WrongPass1!" },
    });
    assert.equal(wrongPassword.status, 401);

    const login = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: validRegistration.email,
        password: validRegistration.password,
      },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data?.user?.status, "ONLINE");
    const loginAccessToken = login.body.data?.accessToken;
    const oldRefreshToken = login.body.data?.refreshToken;
    assert.ok(loginAccessToken);
    assert.ok(oldRefreshToken);

    const refreshed = await apiRequest("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: oldRefreshToken },
    });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.data?.refreshToken, oldRefreshToken);
    const refreshedAccessToken = refreshed.body.data?.accessToken;
    assert.ok(refreshedAccessToken);
    assert.equal(disconnectedSessions.length, 1);

    const reused = await apiRequest("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: oldRefreshToken },
    });
    assert.equal(reused.status, 401);

    const logout = await apiRequest("/api/v1/auth/logout", {
      method: "POST",
      token: refreshedAccessToken,
    });
    assert.equal(logout.status, 200);
    assert.equal(
      sessions.some(({ token }) => token === refreshedAccessToken),
      false,
    );
    assert.equal(disconnectedSessions.length, 2);
  });
});
