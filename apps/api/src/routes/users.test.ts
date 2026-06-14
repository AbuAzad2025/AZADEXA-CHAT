import assert from "node:assert/strict";
import { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import { createUsersRouter } from "./users";

const userId = "cmqd06xfa0000cn13o3jjp001";
let storedUser = {
  id: userId,
  email: "profile@example.com",
  username: "profile_user",
  avatar: null,
  language: "en",
  country: null as string | null,
  status: "ONLINE",
  role: "USER",
  emailVerified: false,
  createdAt: new Date("2026-06-14T00:00:00.000Z"),
  profile: {
    displayName: null as string | null,
    bio: null as string | null,
    activity: null as string | null,
    theme: "system",
    subscriptionTier: "FREE",
  },
};

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === userId ? storedUser : null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: {
        language?: string;
        country?: string | null;
        profile?: {
          upsert: {
            create: Record<string, string | null>;
            update: Record<string, string | null>;
          };
        };
      };
    }) => {
      if (where.id !== userId) throw new Error("User missing");
      storedUser = {
        ...storedUser,
        ...(data.language !== undefined && { language: data.language }),
        ...(data.country !== undefined && { country: data.country }),
        ...(data.profile && {
          profile: {
            ...storedUser.profile,
            ...data.profile.upsert.update,
          },
        }),
      };
      return storedUser;
    },
  },
} as unknown as PrismaClient;

const testAuthenticate: RequestHandler = (req, _res, next) => {
  (req as AuthenticatedRequest).user = {
    id: userId,
    email: storedUser.email,
    username: storedUser.username,
    role: storedUser.role,
  };
  next();
};

const app = express();
app.use(express.json());
app.use(
  "/api/v1/users",
  createUsersRouter({
    prisma: fakePrisma,
    authenticateMiddleware: testAuthenticate,
  }),
);
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const request = async (
  route: string,
  options: { method?: string; body?: object } = {},
) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      success: boolean;
      error?: string;
      data?: { user?: typeof storedUser };
    },
  };
};

describe("current user profile routes", () => {
  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Test server did not expose a TCP port");
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns the authenticated user's profile", async () => {
    const response = await request("/api/v1/users/me");
    assert.equal(response.status, 200);
    assert.equal(response.body.data?.user?.username, "profile_user");
    assert.equal(response.body.data?.user?.profile.subscriptionTier, "FREE");
  });

  it("updates only approved profile fields", async () => {
    const response = await request("/api/v1/users/me", {
      method: "PATCH",
      body: {
        displayName: "Profile Person",
        bio: "A short introduction.",
        activity: "Building communities",
        language: "ar",
        country: "ps",
        role: "SUPER_ADMIN",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.body.data?.user?.profile.displayName,
      "Profile Person",
    );
    assert.equal(response.body.data?.user?.language, "ar");
    assert.equal(response.body.data?.user?.country, "PS");
    assert.equal(response.body.data?.user?.role, "USER");
  });

  it("rejects empty and invalid profile updates", async () => {
    const empty = await request("/api/v1/users/me", {
      method: "PATCH",
      body: {},
    });
    assert.equal(empty.status, 400);

    const invalid = await request("/api/v1/users/me", {
      method: "PATCH",
      body: { country: "Palestine" },
    });
    assert.equal(invalid.status, 400);
  });
});
