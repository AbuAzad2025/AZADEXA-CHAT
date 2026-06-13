import { Server as HttpServer } from "http";
import { Prisma, PrismaClient } from "@prisma/client";
import { Server as SocketIOServer, Socket } from "socket.io";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler";
import { verifyToken } from "../utils/jwt";
import { logger } from "../utils/logger";

type SocketResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type SocketAck<T> = (response: SocketResponse<T>) => void;

interface ClientToServerEvents {
  "room:join": (
    payload: unknown,
    ack?: SocketAck<{ roomId: string }>
  ) => void;
  "room:leave": (
    payload: unknown,
    ack?: SocketAck<{ roomId: string }>
  ) => void;
  "message:send": (
    payload: unknown,
    ack?: SocketAck<{ message: SocketMessage }>
  ) => void;
}

interface ServerToClientEvents {
  "message:new": (message: SocketMessage) => void;
  "operation:error": (error: { event: string; error: string }) => void;
}

interface InterServerEvents {}

interface SocketData {
  sessionId: string;
  token: string;
  tokenExpiresAt: number;
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type ChatServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let socketServer: ChatServer | null = null;

const roomActionSchema = z.object({
  roomId: z.string().cuid(),
});

const sendMessageSchema = roomActionSchema.extend({
  content: z.string().trim().min(1).max(4096),
});

const messageSelect = {
  id: true,
  roomId: true,
  content: true,
  type: true,
  replyTo: true,
  isEdited: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  },
} satisfies Prisma.MessageSelect;

type SocketMessage = Prisma.MessageGetPayload<{
  select: typeof messageSelect;
}>;

const roomChannel = (roomId: string) => `room:${roomId}`;
const sessionChannel = (sessionId: string) => `session:${sessionId}`;

export const disconnectSessionSockets = (sessionId: string) => {
  socketServer?.in(sessionChannel(sessionId)).disconnectSockets(true);
};

const requireActiveSession = async (
  prisma: PrismaClient,
  socket: ChatSocket
) => {
  const session = await prisma.session.findFirst({
    where: {
      token: socket.data.token,
      userId: socket.data.user.id,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!session) throw new AppError("Session expired", 401);
  if (socket.data.tokenExpiresAt <= Date.now()) {
    throw new AppError("Session expired", 401);
  }
};

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || "Invalid request", 400);
  }
  return result.data;
};

const getHandshakeToken = (socket: ChatSocket): string | null => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) return authToken;

  const authorization = socket.handshake.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.substring(7);

  return null;
};

const socketErrorMessage = (error: unknown): string => {
  if (error instanceof AppError) return error.message;
  return "Internal server error";
};

const respondWithError = <T>(
  socket: ChatSocket,
  event: string,
  ack: SocketAck<T> | undefined,
  error: unknown
) => {
  const message = socketErrorMessage(error);
  logger.warn(`Socket ${event} failed: ${message}`, {
    userId: socket.data.user.id,
  });

  if (ack) {
    ack({ success: false, error: message });
    return;
  }

  socket.emit("operation:error", { event, error: message });
};

export const setupWebSocket = (server: HttpServer, prisma: PrismaClient) => {
  const io: ChatServer = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
    },
    maxHttpBufferSize: 1_000_000,
  });
  socketServer = io;

  io.use(async (socket, next) => {
    try {
      const token = getHandshakeToken(socket);
      if (!token) throw new AppError("Authentication required", 401);

      const payload = verifyToken(token);
      if (typeof payload.userId !== "string" || typeof payload.exp !== "number") {
        throw new AppError("Invalid access token", 401);
      }
      const tokenExpiresAt = payload.exp * 1000;
      if (tokenExpiresAt <= Date.now()) {
        throw new AppError("Session expired", 401);
      }

      const session = await prisma.session.findFirst({
        where: {
          token,
          userId: payload.userId,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!session) throw new AppError("Session expired", 401);

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, username: true, role: true },
      });
      if (!user) throw new AppError("User not found", 401);

      socket.data.sessionId = session.id;
      socket.data.token = token;
      socket.data.tokenExpiresAt = tokenExpiresAt;
      socket.data.user = user;
      next();
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "Invalid or expired access token";
      next(new Error(message));
    }
  });

  io.on("connection", (socket) => {
    void socket.join(sessionChannel(socket.data.sessionId));
    const tokenExpiryTimer = setTimeout(
      () => socket.disconnect(true),
      socket.data.tokenExpiresAt - Date.now()
    );

    logger.info("Socket connected", {
      socketId: socket.id,
      userId: socket.data.user.id,
    });

    socket.on("room:join", async (payload, ack) => {
      try {
        await requireActiveSession(prisma, socket);
        const { roomId } = parseOrThrow(roomActionSchema.safeParse(payload));

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
          select: { id: true },
        });
        if (!room) throw new AppError("Room not found", 404);

        const membership = await prisma.roomMember.findUnique({
          where: {
            roomId_userId: { roomId, userId: socket.data.user.id },
          },
          select: { id: true },
        });
        if (!membership) throw new AppError("Join the room before connecting", 403);

        await socket.join(roomChannel(roomId));
        ack?.({ success: true, data: { roomId } });
      } catch (error) {
        respondWithError(socket, "room:join", ack, error);
      }
    });

    socket.on("room:leave", async (payload, ack) => {
      try {
        await requireActiveSession(prisma, socket);
        const { roomId } = parseOrThrow(roomActionSchema.safeParse(payload));

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
          select: { id: true },
        });
        if (!room) throw new AppError("Room not found", 404);

        await socket.leave(roomChannel(roomId));
        ack?.({ success: true, data: { roomId } });
      } catch (error) {
        respondWithError(socket, "room:leave", ack, error);
      }
    });

    socket.on("message:send", async (payload, ack) => {
      try {
        await requireActiveSession(prisma, socket);
        const { roomId, content } = parseOrThrow(
          sendMessageSchema.safeParse(payload)
        );

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
          select: { id: true },
        });
        if (!room) throw new AppError("Room not found", 404);

        if (!socket.rooms.has(roomChannel(roomId))) {
          throw new AppError("Connect to the room before sending messages", 403);
        }

        const membership = await prisma.roomMember.findUnique({
          where: {
            roomId_userId: { roomId, userId: socket.data.user.id },
          },
          select: { isMuted: true },
        });
        if (!membership) throw new AppError("Join the room to send messages", 403);
        if (membership.isMuted) {
          throw new AppError("You are muted in this room", 403);
        }

        const message = await prisma.message.create({
          data: {
            roomId,
            senderId: socket.data.user.id,
            content,
            type: "TEXT",
          },
          select: messageSelect,
        });

        io.to(roomChannel(roomId)).emit("message:new", message);
        ack?.({ success: true, data: { message } });
      } catch (error) {
        respondWithError(socket, "message:send", ack, error);
      }
    });

    socket.on("disconnect", (reason) => {
      clearTimeout(tokenExpiryTimer);
      logger.info("Socket disconnected", {
        socketId: socket.id,
        userId: socket.data.user.id,
        reason,
      });
    });
  });

  return io;
};
