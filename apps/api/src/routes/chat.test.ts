import assert from "node:assert/strict";
import { Server } from "http";
import { after, before, beforeEach, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import { MessageType, PrismaClient, RoomRole, RoomType } from "@prisma/client";
import { AuthenticatedRequest } from "../middleware/auth";
import { AppError, errorHandler } from "../middleware/errorHandler";
import { MESSAGE_RATE_LIMIT_ERROR } from "../middleware/rateLimit";
import { createChatRouter } from "./chat";

interface TestRoom {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: RoomType;
  language: string;
  category: string | null;
  maxUsers: number;
  createdAt: Date;
}

interface TestMembership {
  id: string;
  roomId: string;
  userId: string;
  role: RoomRole;
  isMuted: boolean;
}

interface TestMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  type: MessageType;
  replyTo: null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TestApiResponse {
  success: boolean;
  error?: string;
  data?:
    | Array<{ id: string; type: RoomType; memberCount: number }>
    | {
        id?: string;
        memberCount?: number;
        roomId?: string;
        message?: { id: string; content: string };
        messages?: Array<{ id: string; content: string }>;
        nextCursor?: string | null;
      };
}

const activeUser = {
  id: "cmqd06xfa0000cn13o3jjm901",
  email: "member@example.com",
  username: "member",
  role: "USER",
};
const otherUser = {
  id: "cmqd06xfa0000cn13o3jjm902",
  username: "other",
  avatar: null,
};

const publicRoom: TestRoom = {
  id: "cmqd06xfa0000cn13o3jjm910",
  name: "Global Chat",
  slug: "global-chat",
  description: "A public test room",
  type: "PUBLIC",
  language: "en",
  category: "General",
  maxUsers: 2,
  createdAt: new Date("2026-06-14T00:00:00.000Z"),
};
const privateRoom: TestRoom = {
  ...publicRoom,
  id: "cmqd06xfa0000cn13o3jjm911",
  name: "Private Room",
  slug: "private-room",
  type: "PRIVATE",
};
const fullRoom: TestRoom = {
  ...publicRoom,
  id: "cmqd06xfa0000cn13o3jjm912",
  name: "Full Room",
  slug: "full-room",
  maxUsers: 1,
};

const rooms = [publicRoom, privateRoom, fullRoom];
let memberships: TestMembership[] = [];
let messages: TestMessage[] = [];
let membershipSequence = 0;
let messageSequence = 0;
let blockMessageQuota = false;

const membershipCount = (roomId: string) =>
  memberships.filter((membership) => membership.roomId === roomId).length;

const roomResult = (room: TestRoom) => ({
  ...room,
  _count: { members: membershipCount(room.id) },
});

const messageResult = (message: TestMessage) => ({
  ...message,
  sender:
    message.senderId === activeUser.id
      ? {
          id: activeUser.id,
          username: activeUser.username,
          avatar: null,
        }
      : otherUser,
});

const fakePrismaBase = {
  room: {
    findMany: async ({
      where,
    }: {
      where: { type: RoomType; language?: string; category?: string };
    }) =>
      rooms
        .filter(
          (room) =>
            room.type === where.type &&
            (!where.language || room.language === where.language) &&
            (!where.category || room.category === where.category),
        )
        .map(roomResult),
    findUnique: async ({
      where,
    }: {
      where: { id: string; type?: RoomType };
    }) => {
      const room = rooms.find(
        (item) =>
          item.id === where.id && (!where.type || item.type === where.type),
      );
      return room ? roomResult(room) : null;
    },
  },
  roomMember: {
    findUnique: async ({
      where,
    }: {
      where: { roomId_userId: { roomId: string; userId: string } };
    }) =>
      memberships.find(
        (membership) =>
          membership.roomId === where.roomId_userId.roomId &&
          membership.userId === where.roomId_userId.userId,
      ) || null,
    create: async ({
      data,
    }: {
      data: { roomId: string; userId: string; role: RoomRole };
    }) => {
      membershipSequence += 1;
      const membership: TestMembership = {
        id: `membership-${membershipSequence}`,
        ...data,
        isMuted: false,
      };
      memberships.push(membership);
      return membership;
    },
    deleteMany: async ({
      where,
    }: {
      where: { roomId: string; userId: string };
    }) => {
      const previousLength = memberships.length;
      memberships = memberships.filter(
        (membership) =>
          membership.roomId !== where.roomId ||
          membership.userId !== where.userId,
      );
      return { count: previousLength - memberships.length };
    },
  },
  message: {
    findFirst: async ({
      where,
    }: {
      where: { id: string; roomId: string; isDeleted: boolean };
    }) => {
      const message = messages.find(
        (item) =>
          item.id === where.id &&
          item.roomId === where.roomId &&
          item.isDeleted === where.isDeleted,
      );
      return message ? { id: message.id, createdAt: message.createdAt } : null;
    },
    findMany: async ({
      where,
      take,
    }: {
      where: {
        roomId: string;
        isDeleted: boolean;
        OR?: Array<{
          createdAt?: { lt: Date } | Date;
          id?: { lt: string };
        }>;
      };
      take: number;
    }) => {
      let result = messages.filter(
        (message) =>
          message.roomId === where.roomId &&
          message.isDeleted === where.isDeleted,
      );
      const cursorDate =
        where.OR?.[0]?.createdAt &&
        typeof where.OR[0].createdAt === "object" &&
        "lt" in where.OR[0].createdAt
          ? where.OR[0].createdAt.lt
          : null;
      const cursorId = where.OR?.[1]?.id?.lt;
      if (cursorDate) {
        result = result.filter(
          (message) =>
            message.createdAt < cursorDate ||
            (message.createdAt.getTime() === cursorDate.getTime() &&
              Boolean(cursorId && message.id < cursorId)),
        );
      }
      return result
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, take)
        .map(messageResult);
    },
    create: async ({
      data,
    }: {
      data: {
        roomId: string;
        senderId: string;
        content: string;
        type: MessageType;
      };
    }) => {
      messageSequence += 1;
      const createdAt = new Date(Date.UTC(2026, 5, 14, 4, messageSequence));
      const message: TestMessage = {
        id: `cmqd06xfa0000cn13o3jjm9${String(messageSequence).padStart(2, "0")}`,
        ...data,
        replyTo: null,
        isEdited: false,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
      };
      messages.push(message);
      return messageResult(message);
    },
  },
};

const fakePrisma = {
  ...fakePrismaBase,
  $transaction: async (
    callback: (transaction: PrismaClient) => Promise<unknown>,
  ) => callback(fakePrismaBase as unknown as PrismaClient),
} as unknown as PrismaClient;

const testAuthenticate: RequestHandler = (req, _res, next) => {
  (req as AuthenticatedRequest).user = activeUser;
  next();
};

const app = express();
app.use(express.json());
app.use(
  "/api/v1/chat",
  createChatRouter({
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
    throw new Error("Unable to start chat test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  memberships = [
    {
      id: "full-membership",
      roomId: fullRoom.id,
      userId: otherUser.id,
      role: "MEMBER",
      isMuted: false,
    },
  ];
  messages = [];
  membershipSequence = 0;
  messageSequence = 0;
  blockMessageQuota = false;
});

after(() => {
  server.close();
});

describe("public chat API", () => {
  it("lists and reads public rooms only with optional filters", async () => {
    const listed = await apiRequest("/api/v1/chat/rooms?language=en");
    assert.equal(listed.status, 200);
    assert.deepEqual(
      Array.isArray(listed.body.data)
        ? listed.body.data.map(({ id }) => id).sort()
        : [],
      [fullRoom.id, publicRoom.id].sort(),
    );

    const details = await apiRequest(`/api/v1/chat/rooms/${publicRoom.id}`);
    assert.equal(details.status, 200);
    assert.equal(
      !Array.isArray(details.body.data) ? details.body.data?.memberCount : -1,
      0,
    );

    const hiddenPrivate = await apiRequest(
      `/api/v1/chat/rooms/${privateRoom.id}`,
    );
    assert.equal(hiddenPrivate.status, 404);
  });

  it("joins and leaves idempotently while rejecting full rooms", async () => {
    const joined = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/join`,
      { method: "POST" },
    );
    assert.equal(joined.status, 200);

    const joinedAgain = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/join`,
      { method: "POST" },
    );
    assert.equal(joinedAgain.status, 200);
    assert.equal(membershipCount(publicRoom.id), 1);

    const full = await apiRequest(`/api/v1/chat/rooms/${fullRoom.id}/join`, {
      method: "POST",
    });
    assert.equal(full.status, 409);

    const left = await apiRequest(`/api/v1/chat/rooms/${publicRoom.id}/leave`, {
      method: "POST",
    });
    assert.equal(left.status, 200);
    const leftAgain = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/leave`,
      { method: "POST" },
    );
    assert.equal(leftAgain.status, 200);
  });

  it("protects message history and sending with membership and mute checks", async () => {
    const forbiddenHistory = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/messages`,
    );
    assert.equal(forbiddenHistory.status, 403);

    await apiRequest(`/api/v1/chat/rooms/${publicRoom.id}/join`, {
      method: "POST",
    });

    for (const content of ["first", "second", "third"]) {
      const sent = await apiRequest(
        `/api/v1/chat/rooms/${publicRoom.id}/messages`,
        { method: "POST", body: { content } },
      );
      assert.equal(sent.status, 201);
    }

    const history = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/messages?limit=2`,
    );
    assert.equal(history.status, 200);
    assert.deepEqual(
      !Array.isArray(history.body.data)
        ? history.body.data?.messages?.map(({ content }) => content)
        : [],
      ["second", "third"],
    );
    assert.ok(
      !Array.isArray(history.body.data) && history.body.data?.nextCursor,
    );

    const membership = memberships.find(
      (item) => item.roomId === publicRoom.id && item.userId === activeUser.id,
    );
    assert.ok(membership);
    membership.isMuted = true;
    const muted = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/messages`,
      { method: "POST", body: { content: "blocked" } },
    );
    assert.equal(muted.status, 403);
  });

  it("rejects room messages when the user message quota is exhausted", async () => {
    await apiRequest(`/api/v1/chat/rooms/${publicRoom.id}/join`, {
      method: "POST",
    });
    blockMessageQuota = true;

    const limited = await apiRequest(
      `/api/v1/chat/rooms/${publicRoom.id}/messages`,
      { method: "POST", body: { content: "one too many" } },
    );

    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, MESSAGE_RATE_LIMIT_ERROR);
    assert.equal(messages.length, 0);
  });
});
