import { RequestHandler, Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  consumeMessageQuota,
  ConsumeMessageQuota,
} from "../middleware/rateLimit";

const MAX_JOIN_ATTEMPTS = 3;
const DEFAULT_MESSAGE_LIMIT = 50;

const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_MESSAGE_LIMIT),
  before: z.string().cuid().optional(),
});

const sendMessageSchema = z.object({
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

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(
      result.error.issues[0]?.message || "Invalid request",
      400,
    );
  }
  return result.data;
};

interface ChatRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
  consumeQuota?: ConsumeMessageQuota;
}

export const createChatRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
  consumeQuota = consumeMessageQuota,
}: ChatRouterDependencies = {}): Router => {
  const router = Router();

  // GET /api/v1/chat/rooms
  router.get("/rooms", async (req, res, next) => {
    try {
      const { language, category } = req.query;
      const rooms = await prisma.room.findMany({
        where: {
          type: "PUBLIC",
          ...(language && { language: language as string }),
          ...(category && { category: category as string }),
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          language: true,
          category: true,
          maxUsers: true,
          _count: { select: { members: true } },
          createdAt: true,
        },
      });

      const formattedRooms = rooms.map((room) => ({
        ...room,
        memberCount: room._count.members,
        _count: undefined,
      }));

      res.json({ success: true, data: formattedRooms });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/chat/rooms/:roomId
  router.get("/rooms/:roomId", async (req, res, next) => {
    try {
      const { roomId } = req.params;
      const room = await prisma.room.findUnique({
        where: { id: roomId, type: "PUBLIC" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          language: true,
          category: true,
          maxUsers: true,
          _count: { select: { members: true } },
          createdAt: true,
        },
      });

      if (!room) throw new AppError("Room not found", 404);

      res.json({
        success: true,
        data: { ...room, memberCount: room._count.members, _count: undefined },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/chat/rooms/:roomId/join
  router.post(
    "/rooms/:roomId/join",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const { roomId } = req.params;
        const userId = (req as AuthenticatedRequest).user!.id;

        for (let attempt = 1; attempt <= MAX_JOIN_ATTEMPTS; attempt += 1) {
          try {
            await prisma.$transaction(
              async (tx) => {
                const room = await tx.room.findUnique({
                  where: { id: roomId, type: "PUBLIC" },
                  select: {
                    maxUsers: true,
                    _count: { select: { members: true } },
                  },
                });

                if (!room) throw new AppError("Room not found", 404);

                const existingMembership = await tx.roomMember.findUnique({
                  where: { roomId_userId: { roomId, userId } },
                });

                if (existingMembership) return;
                if (room._count.members >= room.maxUsers) {
                  throw new AppError("Room is full", 409);
                }

                await tx.roomMember.create({
                  data: { roomId, userId, role: "MEMBER" },
                });
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
            return res.json({ success: true, data: { roomId } });
          } catch (err) {
            const isRetryable =
              err instanceof Prisma.PrismaClientKnownRequestError &&
              (err.code === "P2002" || err.code === "P2034");

            if (!isRetryable || attempt === MAX_JOIN_ATTEMPTS) throw err;
          }
        }

        throw new AppError("Unable to join room", 409);
      } catch (err) {
        return next(err);
      }
    },
  );

  // POST /api/v1/chat/rooms/:roomId/leave
  router.post(
    "/rooms/:roomId/leave",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const { roomId } = req.params;
        const userId = (req as AuthenticatedRequest).user!.id;

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
        });

        if (!room) return next(new AppError("Room not found", 404));

        await prisma.roomMember.deleteMany({
          where: { roomId, userId },
        });

        return res.json({ success: true, data: { roomId } });
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /api/v1/chat/rooms/:roomId/messages
  router.get(
    "/rooms/:roomId/messages",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const { roomId } = req.params;
        const userId = (req as AuthenticatedRequest).user!.id;
        const { limit, before } = parseOrThrow(
          messageHistoryQuerySchema.safeParse(req.query),
        );

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
          select: { id: true },
        });
        if (!room) throw new AppError("Room not found", 404);

        const membership = await prisma.roomMember.findUnique({
          where: { roomId_userId: { roomId, userId } },
          select: { id: true },
        });
        if (!membership)
          throw new AppError("Join the room to view messages", 403);

        let beforeMessage: {
          id: string;
          createdAt: Date;
        } | null = null;

        if (before) {
          beforeMessage = await prisma.message.findFirst({
            where: { id: before, roomId, isDeleted: false },
            select: { id: true, createdAt: true },
          });
          if (!beforeMessage) throw new AppError("Invalid message cursor", 400);
        }

        const messages = await prisma.message.findMany({
          where: {
            roomId,
            isDeleted: false,
            ...(beforeMessage && {
              OR: [
                { createdAt: { lt: beforeMessage.createdAt } },
                {
                  createdAt: beforeMessage.createdAt,
                  id: { lt: beforeMessage.id },
                },
              ],
            }),
          },
          select: messageSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        });

        const hasMore = messages.length > limit;
        const page = hasMore ? messages.slice(0, limit) : messages;
        const nextCursor = hasMore ? page[page.length - 1]?.id || null : null;

        return res.json({
          success: true,
          data: {
            messages: [...page].reverse(),
            nextCursor,
          },
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  // POST /api/v1/chat/rooms/:roomId/messages
  router.post(
    "/rooms/:roomId/messages",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const { roomId } = req.params;
        const userId = (req as AuthenticatedRequest).user!.id;
        const { content } = parseOrThrow(sendMessageSchema.safeParse(req.body));

        const room = await prisma.room.findUnique({
          where: { id: roomId, type: "PUBLIC" },
          select: { id: true },
        });
        if (!room) throw new AppError("Room not found", 404);

        const membership = await prisma.roomMember.findUnique({
          where: { roomId_userId: { roomId, userId } },
          select: { isMuted: true },
        });
        if (!membership)
          throw new AppError("Join the room to send messages", 403);
        if (membership.isMuted)
          throw new AppError("You are muted in this room", 403);

        consumeQuota(userId);
        const message = await prisma.message.create({
          data: {
            roomId,
            senderId: userId,
            content,
            type: "TEXT",
          },
          select: messageSelect,
        });

        return res.status(201).json({
          success: true,
          data: { message },
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
};

export default createChatRouter();
