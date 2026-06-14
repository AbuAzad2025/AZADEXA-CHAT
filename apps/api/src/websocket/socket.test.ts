import assert from "node:assert/strict";
import { createServer, Server as HttpServer } from "http";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  io as createSocketClient,
  Socket as ClientSocket,
} from "socket.io-client";
import { AppError } from "../middleware/errorHandler";
import { MESSAGE_RATE_LIMIT_ERROR } from "../middleware/rateLimit";
import { generateToken } from "../utils/jwt";
import { setupWebSocket } from "./socket";

interface TestUser {
  id: string;
  email: string;
  username: string;
  role: string;
}

interface TestSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

interface SocketAck<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const alice: TestUser = {
  id: "cmqd06xfa0000cn13o3jja001",
  email: "alice@example.com",
  username: "alice",
  role: "USER",
};
const bob: TestUser = {
  id: "cmqd06xfa0000cn13o3jja002",
  email: "bob@example.com",
  username: "bobby",
  role: "USER",
};
const roomId = "cmqd06xfa0000cn13o3jja010";
const users = [alice, bob];
let sessions: TestSession[] = [];
let memberships = new Set<string>();
let messageSequence = 0;
let quotaBlockedUsers = new Set<string>();

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
    }) =>
      sessions.find(
        (session) =>
          session.token === where.token &&
          session.userId === where.userId &&
          session.expiresAt > where.expiresAt.gt,
      )
        ? { id: sessions.find(({ token }) => token === where.token)!.id }
        : null,
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      users.find(({ id }) => id === where.id) || null,
  },
  room: {
    findUnique: async ({ where }: { where: { id: string; type: string } }) =>
      where.id === roomId && where.type === "PUBLIC" ? { id: roomId } : null,
  },
  roomMember: {
    findUnique: async ({
      where,
    }: {
      where: { roomId_userId: { roomId: string; userId: string } };
    }) =>
      memberships.has(
        `${where.roomId_userId.roomId}:${where.roomId_userId.userId}`,
      )
        ? { id: "membership-1", isMuted: false }
        : null,
  },
  message: {
    create: async ({
      data,
    }: {
      data: {
        roomId: string;
        senderId: string;
        content: string;
        type: "TEXT";
      };
    }) => {
      messageSequence += 1;
      const sender = users.find(({ id }) => id === data.senderId)!;
      const createdAt = new Date();
      return {
        id: `message-${messageSequence}`,
        ...data,
        replyTo: null,
        isEdited: false,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
        sender: {
          id: sender.id,
          username: sender.username,
          avatar: null,
        },
      };
    },
  },
  privateMessage: {
    create: async ({
      data,
    }: {
      data: {
        senderId: string;
        receiverId: string;
        content: string;
        type: "TEXT";
      };
    }) => {
      messageSequence += 1;
      const sender = users.find(({ id }) => id === data.senderId)!;
      const receiver = users.find(({ id }) => id === data.receiverId)!;
      return {
        id: `private-message-${messageSequence}`,
        ...data,
        isRead: false,
        createdAt: new Date(),
        sender: {
          id: sender.id,
          username: sender.username,
          avatar: null,
        },
        receiver: {
          id: receiver.id,
          username: receiver.username,
          avatar: null,
        },
      };
    },
  },
} as unknown as PrismaClient;

let server: HttpServer;
let baseUrl = "";
let aliceToken = "";
let bobToken = "";
let clients: ClientSocket[] = [];

const connectClient = (
  token?: string,
): Promise<{ client: ClientSocket; error?: Error }> =>
  new Promise((resolve) => {
    const client = createSocketClient(baseUrl, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    clients.push(client);
    client.once("connect", () => resolve({ client }));
    client.once("connect_error", (error) => resolve({ client, error }));
  });

const emitWithAck = <T>(
  client: ClientSocket,
  event: string,
  payload: object,
): Promise<SocketAck<T>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event} acknowledgement`)),
      3000,
    );
    client.emit(event, payload, (response: SocketAck<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

const waitForEvent = <T>(client: ClientSocket, event: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      3000,
    );
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

before(() => {
  process.env.JWT_SECRET = "socket-test-access-secret";
  process.env.FRONTEND_URL = "http://localhost:3000";
  server = createServer();
  setupWebSocket(server, fakePrisma, {
    consumeQuota: (userId) => {
      if (quotaBlockedUsers.has(userId)) {
        throw new AppError(MESSAGE_RATE_LIMIT_ERROR, 429);
      }
    },
  });
  server.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start WebSocket test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  clients.forEach((client) => client.disconnect());
  clients = [];
  memberships = new Set();
  messageSequence = 0;
  quotaBlockedUsers = new Set();
  aliceToken = generateToken(alice.id);
  bobToken = generateToken(bob.id);
  sessions = [
    {
      id: "session-alice",
      userId: alice.id,
      token: aliceToken,
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: "session-bob",
      userId: bob.id,
      token: bobToken,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];
});

after(() => {
  clients.forEach((client) => client.disconnect());
  server.close();
});

describe("chat WebSocket", () => {
  it("rejects an unauthenticated handshake", async () => {
    const { error } = await connectClient();
    assert.ok(error);
    assert.equal(error.message, "Authentication required");
  });

  it("requires room membership and broadcasts a public message after joining", async () => {
    const { client, error } = await connectClient(aliceToken);
    assert.equal(error, undefined);

    const forbidden = await emitWithAck<{ roomId: string }>(
      client,
      "room:join",
      { roomId },
    );
    assert.equal(forbidden.success, false);
    assert.equal(forbidden.error, "Join the room before connecting");

    memberships.add(`${roomId}:${alice.id}`);
    const joined = await emitWithAck<{ roomId: string }>(client, "room:join", {
      roomId,
    });
    assert.equal(joined.success, true);

    const received = waitForEvent<{ content: string }>(client, "message:new");
    const sent = await emitWithAck<{ message: { content: string } }>(
      client,
      "message:send",
      { roomId, content: "Hello room" },
    );
    assert.equal(sent.success, true);
    assert.equal(sent.data?.message.content, "Hello room");
    assert.equal((await received).content, "Hello room");
  });

  it("delivers a private message to the connected receiver", async () => {
    const { client: aliceClient } = await connectClient(aliceToken);
    const { client: bobClient } = await connectClient(bobToken);

    const received = waitForEvent<{
      content: string;
      senderId: string;
      receiverId: string;
    }>(bobClient, "private:new");
    const sent = await emitWithAck<{ message: { content: string } }>(
      aliceClient,
      "private:send",
      { receiverId: bob.id, content: "Private hello" },
    );

    assert.equal(sent.success, true);
    const message = await received;
    assert.equal(message.content, "Private hello");
    assert.equal(message.senderId, alice.id);
    assert.equal(message.receiverId, bob.id);
  });

  it("applies the same user quota to public and private socket messages", async () => {
    memberships.add(`${roomId}:${alice.id}`);
    const { client } = await connectClient(aliceToken);
    const joined = await emitWithAck<{ roomId: string }>(client, "room:join", {
      roomId,
    });
    assert.equal(joined.success, true);

    quotaBlockedUsers.add(alice.id);
    const publicMessage = await emitWithAck(client, "message:send", {
      roomId,
      content: "one too many",
    });
    const privateMessage = await emitWithAck(client, "private:send", {
      receiverId: bob.id,
      content: "still one too many",
    });

    assert.equal(publicMessage.success, false);
    assert.equal(publicMessage.error, MESSAGE_RATE_LIMIT_ERROR);
    assert.equal(privateMessage.success, false);
    assert.equal(privateMessage.error, MESSAGE_RATE_LIMIT_ERROR);
    assert.equal(messageSequence, 0);
  });
});
