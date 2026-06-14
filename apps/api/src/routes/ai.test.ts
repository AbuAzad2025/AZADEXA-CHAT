import assert from "node:assert/strict";
import { Server } from "http";
import { after, before, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import {
  ZESTY_BLOCKED_PLACEHOLDER,
  ZestyMessage,
  ZestyModerationResult,
  ZestyProvider,
} from "../services/zesty";
import { countMessagesSince, createAiRouter, parseStoredMessages } from "./ai";

interface TestUser {
  id: string;
  email: string;
  username: string;
  role: string;
}

interface FakeConversation {
  id: string;
  userId: string;
  messages: Prisma.JsonValue;
  moodDetected: string | null;
  flaggedContent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TestApiResponse {
  success: boolean;
  error?: string;
  data?: {
    conversation?: {
      id: string;
      messages: ZestyMessage[];
    };
    conversations?: {
      id: string;
      messageCount: number;
    }[];
    conversationId?: string;
    flagged?: boolean;
    remainingMessages?: number;
    reply?: ZestyMessage;
  };
}

class FakeZestyProvider implements ZestyProvider {
  isConfigured(): boolean {
    return true;
  }

  async moderate(content: string): Promise<ZestyModerationResult> {
    return content.includes("blocked")
      ? { flagged: true, categories: ["test-policy"] }
      : { flagged: false, categories: [] };
  }

  async generateReply(
    messages: Pick<ZestyMessage, "role" | "content">[]
  ): Promise<string> {
    if (messages[messages.length - 1]?.content.includes("unsafe output")) {
      return "blocked generated response";
    }
    return `Safe reply to: ${messages[messages.length - 1]?.content || ""}`;
  }
}

const owner: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm570",
  email: "zesty-owner@example.com",
  username: "zesty_owner",
  role: "USER",
};
const otherUser: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm571",
  email: "zesty-other@example.com",
  username: "zesty_other",
  role: "USER",
};
const quotaUser: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm572",
  email: "zesty-quota@example.com",
  username: "zesty_quota",
  role: "USER",
};

const conversations: FakeConversation[] = [];
let conversationSequence = 0;
let activeUser = owner;

const asJsonValue = (value: Prisma.InputJsonValue): Prisma.JsonValue =>
  value as Prisma.JsonValue;

const fakePrisma = {
  aIConversation: {
    findMany: async ({ where }: { where: { userId: string } }) =>
      conversations
        .filter((conversation) => conversation.userId === where.userId)
        .sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
        ),
    findFirst: async ({
      where,
    }: {
      where: { id: string; userId: string };
    }) =>
      conversations.find(
        (conversation) =>
          conversation.id === where.id && conversation.userId === where.userId
      ) || null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const conversation = conversations.find(({ id }) => id === where.id);
      if (!conversation) throw new Error("Conversation missing");
      return conversation;
    },
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        messages: Prisma.InputJsonValue;
        flaggedContent?: boolean;
      };
    }) => {
      conversationSequence += 1;
      const now = new Date();
      const conversation: FakeConversation = {
        id: `cmqd06xfa0000cn13o3jjm6${conversationSequence
          .toString()
          .padStart(2, "0")}`,
        userId: data.userId,
        messages: asJsonValue(data.messages),
        moodDetected: null,
        flaggedContent: data.flaggedContent || false,
        createdAt: now,
        updatedAt: now,
      };
      conversations.push(conversation);
      return conversation;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: {
        messages: Prisma.InputJsonValue;
        flaggedContent: boolean;
      };
    }) => {
      const conversation = conversations.find(({ id }) => id === where.id);
      if (!conversation) throw new Error("Conversation missing");
      conversation.messages = asJsonValue(data.messages);
      conversation.flaggedContent = data.flaggedContent;
      conversation.updatedAt = new Date();
      return conversation;
    },
    deleteMany: async ({
      where,
    }: {
      where: { id: string; userId: string };
    }) => {
      const index = conversations.findIndex(
        (conversation) =>
          conversation.id === where.id && conversation.userId === where.userId
      );
      if (index === -1) return { count: 0 };
      conversations.splice(index, 1);
      return { count: 1 };
    },
  },
} as unknown as PrismaClient;

const testAuthenticate: RequestHandler = (req, _res, next) => {
  (req as AuthenticatedRequest).user = activeUser;
  next();
};

const app = express();
app.use(express.json());
app.use(
  "/api/v1/ai",
  createAiRouter({
    prisma: fakePrisma,
    provider: new FakeZestyProvider(),
    authenticateMiddleware: testAuthenticate,
  })
);
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const apiRequest = async (
  route: string,
  options: { method?: string; body?: object } = {}
): Promise<{ status: number; body: TestApiResponse }> => {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    status: response.status,
    body: (await response.json()) as TestApiResponse,
  };
};

describe("Zesty AI routes", () => {
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

  it("creates, continues, lists, reads, and deletes an owned conversation", async () => {
    activeUser = owner;
    const created = await apiRequest("/api/v1/ai/chat", {
      method: "POST",
      body: { message: "Hello Zesty" },
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data?.conversation?.messages.length, 2);
    assert.equal(created.body.data?.remainingMessages, 19);
    const conversationId = created.body.data?.conversation?.id;
    assert.ok(conversationId);

    const continued = await apiRequest("/api/v1/ai/chat", {
      method: "POST",
      body: { message: "One more question", conversationId },
    });
    assert.equal(continued.status, 200);
    assert.equal(continued.body.data?.conversation?.messages.length, 4);
    assert.match(continued.body.data?.reply?.content || "", /One more question/);

    const listed = await apiRequest("/api/v1/ai/conversations");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data?.conversations?.[0]?.id, conversationId);
    assert.equal(listed.body.data?.conversations?.[0]?.messageCount, 4);

    const fetched = await apiRequest(`/api/v1/ai/conversations/${conversationId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data?.conversation?.messages.length, 4);

    activeUser = otherUser;
    const forbiddenRead = await apiRequest(
      `/api/v1/ai/conversations/${conversationId}`
    );
    assert.equal(forbiddenRead.status, 404);

    activeUser = owner;
    const deleted = await apiRequest(`/api/v1/ai/conversations/${conversationId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    const missing = await apiRequest(`/api/v1/ai/conversations/${conversationId}`);
    assert.equal(missing.status, 404);
  });

  it("blocks unsafe input without storing the raw content", async () => {
    activeUser = owner;
    const response = await apiRequest("/api/v1/ai/chat", {
      method: "POST",
      body: { message: "This is blocked test content" },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.data?.flagged, true);
    const conversationId = response.body.data?.conversationId;
    assert.ok(conversationId);
    const stored = await fakePrisma.aIConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const messages = parseStoredMessages(stored.messages);
    assert.equal(messages[0]?.content, ZESTY_BLOCKED_PLACEHOLDER);
    assert.equal(JSON.stringify(stored.messages).includes("blocked test content"), false);
  });

  it("replaces a flagged model output with the safe fallback", async () => {
    activeUser = owner;
    const response = await apiRequest("/api/v1/ai/chat", {
      method: "POST",
      body: { message: "Please trigger unsafe output" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data?.reply?.blocked, true);
    assert.equal(
      response.body.data?.reply?.content.includes("blocked generated response"),
      false
    );
  });

  it("enforces the daily 20-message quota", async () => {
    activeUser = quotaUser;
    const createdAt = new Date().toISOString();
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: "user" as const,
      content: `message-${index}`,
      createdAt,
    }));
    await fakePrisma.aIConversation.create({
      data: {
        userId: quotaUser.id,
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    });

    const response = await apiRequest("/api/v1/ai/chat", {
      method: "POST",
      body: { message: "One too many" },
    });

    assert.equal(response.status, 429);
    assert.match(response.body.error || "", /Daily Zesty limit reached/);
  });

  it("counts user messages since the requested time", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const messages = [
      { role: "user", content: "new", createdAt: now.toISOString() },
      { role: "assistant", content: "reply", createdAt: now.toISOString() },
      { role: "user", content: "old", createdAt: old.toISOString() },
    ] satisfies ZestyMessage[];

    assert.equal(
      countMessagesSince(
        [{ messages: messages as unknown as Prisma.JsonValue }],
        new Date(now.getTime() - 60 * 60 * 1000)
      ),
      1
    );
  });
});
