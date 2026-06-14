import assert from "node:assert/strict";
import { Server } from "http";
import { after, before, beforeEach, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import {
  MessageType,
  PrismaClient,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { AuthenticatedRequest } from "../middleware/auth";
import { AppError, errorHandler } from "../middleware/errorHandler";
import { MESSAGE_RATE_LIMIT_ERROR } from "../middleware/rateLimit";
import { createPrivateMessagesRouter } from "./privateMessages";
import { createUsersRouter } from "./users";

interface TestUser {
  id: string;
  email: string;
  username: string;
  avatar: null;
  status: UserStatus;
  role: UserRole;
}

interface TestPrivateMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: MessageType;
  isRead: boolean;
  createdAt: Date;
}

interface TestApiResponse {
  success: boolean;
  error?: string;
  data?: {
    users?: Array<{ id: string; username: string }>;
    message?: { id: string; content: string; isRead: boolean };
    messages?: Array<{ id: string; content: string; isRead: boolean }>;
    conversations?: Array<{
      user: { id: string; username: string };
      unreadCount: number;
      lastMessage: { content: string };
    }>;
    updatedCount?: number;
  };
}

const alice: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm601",
  email: "alice@example.com",
  username: "alice",
  avatar: null,
  status: "ONLINE",
  role: "USER",
};
const bob: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm602",
  email: "bob@example.com",
  username: "bobby",
  avatar: null,
  status: "OFFLINE",
  role: "USER",
};
const carol: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm603",
  email: "carol@example.com",
  username: "carol",
  avatar: null,
  status: "AWAY",
  role: "USER",
};

const users = [alice, bob, carol];
let activeUser = alice;
let messageSequence = 0;
let privateMessages: TestPrivateMessage[] = [];
let blockMessageQuota = false;

const publicUser = (userId: string) => {
  const user = users.find(({ id }) => id === userId);
  if (!user) throw new Error("Test user missing");
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    status: user.status,
  };
};

const presentedMessage = (message: TestPrivateMessage) => ({
  ...message,
  sender: publicUser(message.senderId),
  receiver: publicUser(message.receiverId),
});

const inConversation = (
  message: TestPrivateMessage,
  firstUserId: string,
  secondUserId: string,
) =>
  (message.senderId === firstUserId && message.receiverId === secondUserId) ||
  (message.senderId === secondUserId && message.receiverId === firstUserId);

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const user = users.find(({ id }) => id === where.id);
      return user ? publicUser(user.id) : null;
    },
    findMany: async ({
      where,
      take,
    }: {
      where: {
        id: { not: string };
        username: { contains: string };
      };
      take: number;
    }) =>
      users
        .filter(
          (user) =>
            user.id !== where.id.not &&
            user.username
              .toLowerCase()
              .includes(where.username.contains.toLowerCase()),
        )
        .sort((left, right) => left.username.localeCompare(right.username))
        .slice(0, take)
        .map(({ id }) => publicUser(id)),
  },
  privateMessage: {
    findMany: async ({
      where,
      take,
    }: {
      where: {
        OR?: Array<{ senderId?: string; receiverId?: string }>;
        AND?: Array<{
          OR: Array<{
            createdAt?: { lt: Date } | Date;
            id?: { lt: string };
          }>;
        }>;
      };
      take: number;
    }) => {
      let results = [...privateMessages];
      if (where.OR?.length === 2) {
        const first = where.OR[0];
        const second = where.OR[1];
        if (
          first.senderId &&
          first.receiverId &&
          second.senderId &&
          second.receiverId
        ) {
          results = results.filter((message) =>
            inConversation(message, first.senderId!, first.receiverId!),
          );
        } else {
          const currentUserId = first.senderId || first.receiverId;
          results = results.filter(
            (message) =>
              message.senderId === currentUserId ||
              message.receiverId === currentUserId,
          );
        }
      }

      const cursor = where.AND?.[0]?.OR;
      if (cursor) {
        const createdAt = cursor[0]?.createdAt;
        const cursorDate =
          createdAt && typeof createdAt === "object" && "lt" in createdAt
            ? createdAt.lt
            : null;
        const cursorId = cursor[1]?.id?.lt;
        if (cursorDate) {
          results = results.filter(
            (message) =>
              message.createdAt < cursorDate ||
              (message.createdAt.getTime() === cursorDate.getTime() &&
                Boolean(cursorId && message.id < cursorId)),
          );
        }
      }

      return results
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, take)
        .map(presentedMessage);
    },
    findFirst: async ({
      where,
    }: {
      where: {
        id: string;
        OR: Array<{ senderId: string; receiverId: string }>;
      };
    }) => {
      const first = where.OR[0];
      const message = privateMessages.find(
        (item) =>
          item.id === where.id &&
          inConversation(item, first.senderId, first.receiverId),
      );
      return message ? { id: message.id, createdAt: message.createdAt } : null;
    },
    create: async ({
      data,
    }: {
      data: {
        senderId: string;
        receiverId: string;
        content: string;
        type: MessageType;
      };
    }) => {
      messageSequence += 1;
      const message: TestPrivateMessage = {
        id: `cmqd06xfa0000cn13o3jjm6${String(messageSequence).padStart(2, "0")}`,
        ...data,
        isRead: false,
        createdAt: new Date(Date.UTC(2026, 5, 14, 3, messageSequence)),
      };
      privateMessages.push(message);
      return presentedMessage(message);
    },
    groupBy: async ({
      where,
    }: {
      where: { receiverId: string; isRead: boolean };
    }) => {
      const counts = new Map<string, number>();
      privateMessages
        .filter(
          (message) =>
            message.receiverId === where.receiverId &&
            message.isRead === where.isRead,
        )
        .forEach((message) =>
          counts.set(message.senderId, (counts.get(message.senderId) || 0) + 1),
        );
      return [...counts].map(([senderId, count]) => ({
        senderId,
        _count: { _all: count },
      }));
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { senderId: string; receiverId: string; isRead: boolean };
      data: { isRead: boolean };
    }) => {
      let count = 0;
      privateMessages = privateMessages.map((message) => {
        if (
          message.senderId === where.senderId &&
          message.receiverId === where.receiverId &&
          message.isRead === where.isRead
        ) {
          count += 1;
          return { ...message, ...data };
        }
        return message;
      });
      return { count };
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
  "/api/v1/users",
  createUsersRouter({
    prisma: fakePrisma,
    authenticateMiddleware: testAuthenticate,
  }),
);
app.use(
  "/api/v1/chat/private",
  createPrivateMessagesRouter({
    prisma: fakePrisma,
    authenticateMiddleware: testAuthenticate,
    consumeQuota: () => {
      if (blockMessageQuota) {
        throw new AppError(MESSAGE_RATE_LIMIT_ERROR, 429);
      }
    },
  }),
);
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const apiRequest = async (
  route: string,
  options: { method?: string; body?: object } = {},
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

before(() => {
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start private-message test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  activeUser = alice;
  messageSequence = 0;
  privateMessages = [];
  blockMessageQuota = false;
});

after(() => {
  server.close();
});

describe("private messages API", () => {
  it("searches users by username without returning the caller", async () => {
    const response = await apiRequest("/api/v1/users/search?q=bo");

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.data?.users?.map(({ username }) => username),
      ["bobby"],
    );
  });

  it("sends, lists, reads, and marks a private conversation read", async () => {
    activeUser = bob;
    const incoming = await apiRequest(
      `/api/v1/chat/private/${alice.id}/messages`,
      {
        method: "POST",
        body: { content: "Hello Alice" },
      },
    );
    assert.equal(incoming.status, 201);

    activeUser = alice;
    const outgoing = await apiRequest(
      `/api/v1/chat/private/${bob.id}/messages`,
      {
        method: "POST",
        body: { content: "Hi Bobby" },
      },
    );
    assert.equal(outgoing.status, 201);

    const conversations = await apiRequest(
      "/api/v1/chat/private/conversations",
    );
    assert.equal(conversations.status, 200);
    assert.equal(conversations.body.data?.conversations?.[0]?.user.id, bob.id);
    assert.equal(
      conversations.body.data?.conversations?.[0]?.lastMessage.content,
      "Hi Bobby",
    );
    assert.equal(conversations.body.data?.conversations?.[0]?.unreadCount, 1);

    const history = await apiRequest(`/api/v1/chat/private/${bob.id}/messages`);
    assert.equal(history.status, 200);
    assert.deepEqual(
      history.body.data?.messages?.map(({ content }) => content),
      ["Hello Alice", "Hi Bobby"],
    );

    const markedRead = await apiRequest(`/api/v1/chat/private/${bob.id}/read`, {
      method: "POST",
    });
    assert.equal(markedRead.status, 200);
    assert.equal(markedRead.body.data?.updatedCount, 1);

    const refreshed = await apiRequest("/api/v1/chat/private/conversations");
    assert.equal(refreshed.body.data?.conversations?.[0]?.unreadCount, 0);
  });

  it("rejects attempts to message the current user", async () => {
    const response = await apiRequest(
      `/api/v1/chat/private/${alice.id}/messages`,
      {
        method: "POST",
        body: { content: "Talking to myself" },
      },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "You cannot message yourself");
  });

  it("rejects private messages when the user message quota is exhausted", async () => {
    blockMessageQuota = true;
    const response = await apiRequest(
      `/api/v1/chat/private/${bob.id}/messages`,
      {
        method: "POST",
        body: { content: "one too many" },
      },
    );

    assert.equal(response.status, 429);
    assert.equal(response.body.error, MESSAGE_RATE_LIMIT_ERROR);
    assert.equal(privateMessages.length, 0);
  });
});
