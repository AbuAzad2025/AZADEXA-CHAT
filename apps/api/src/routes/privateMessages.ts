import { RequestHandler, Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_CONVERSATIONS = 50;
const CONVERSATION_SCAN_LIMIT = 500;

const userParamsSchema = z.object({
  userId: z.string().cuid(),
});

const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_MESSAGE_LIMIT),
  before: z.string().cuid().optional(),
});

const sendPrivateMessageSchema = z.object({
  content: z.string().trim().min(1).max(4096),
});

const privateMessageSelect = {
  id: true,
  senderId: true,
  receiverId: true,
  content: true,
  type: true,
  isRead: true,
  createdAt: true,
  sender: {
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  },
  receiver: {
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  },
} satisfies Prisma.PrivateMessageSelect;

export type PrivateMessagePayload = Prisma.PrivateMessageGetPayload<{
  select: typeof privateMessageSelect;
}>;

interface PrivateMessagesRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
}

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || "Invalid request", 400);
  }
  return result.data;
};

const conversationWhere = (currentUserId: string, otherUserId: string) => ({
  OR: [
    { senderId: currentUserId, receiverId: otherUserId },
    { senderId: otherUserId, receiverId: currentUserId },
  ],
});

export const createPrivateMessagesRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
}: PrivateMessagesRouterDependencies = {}): Router => {
  const router = Router();

  router.use(authenticateMiddleware);

  router.get("/conversations", async (req, res, next) => {
    try {
      const userId = (req as AuthenticatedRequest).user!.id;
      const recentMessages = await prisma.privateMessage.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
        select: privateMessageSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: CONVERSATION_SCAN_LIMIT,
      });

      const unreadBySender = await prisma.privateMessage.groupBy({
        by: ["senderId"],
        where: { receiverId: userId, isRead: false },
        _count: { _all: true },
      });
      const unreadCounts = new Map(
        unreadBySender.map((entry) => [entry.senderId, entry._count._all])
      );

      const seen = new Set<string>();
      const conversations = [];
      for (const message of recentMessages) {
        const otherUser =
          message.senderId === userId ? message.receiver : message.sender;
        if (seen.has(otherUser.id)) continue;
        seen.add(otherUser.id);
        conversations.push({
          user: otherUser,
          lastMessage: message,
          unreadCount: unreadCounts.get(otherUser.id) || 0,
        });
        if (conversations.length === MAX_CONVERSATIONS) break;
      }

      return res.json({
        success: true,
        data: { conversations },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:userId/messages", async (req, res, next) => {
    try {
      const currentUserId = (req as AuthenticatedRequest).user!.id;
      const { userId: otherUserId } = parseOrThrow(
        userParamsSchema.safeParse(req.params)
      );
      const { limit, before } = parseOrThrow(
        messageHistoryQuerySchema.safeParse(req.query)
      );
      if (currentUserId === otherUserId) {
        throw new AppError("Private conversations require another user", 400);
      }

      const otherUser = await prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true, username: true, avatar: true },
      });
      if (!otherUser) throw new AppError("User not found", 404);

      const beforeMessage = before
        ? await prisma.privateMessage.findFirst({
            where: {
              id: before,
              ...conversationWhere(currentUserId, otherUserId),
            },
            select: { id: true, createdAt: true },
          })
        : null;
      if (before && !beforeMessage) {
        throw new AppError("Invalid message cursor", 400);
      }

      const messages = await prisma.privateMessage.findMany({
        where: {
          ...conversationWhere(currentUserId, otherUserId),
          ...(beforeMessage && {
            AND: [
              {
                OR: [
                  { createdAt: { lt: beforeMessage.createdAt } },
                  {
                    createdAt: beforeMessage.createdAt,
                    id: { lt: beforeMessage.id },
                  },
                ],
              },
            ],
          }),
        },
        select: privateMessageSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;

      return res.json({
        success: true,
        data: {
          user: otherUser,
          messages: [...page].reverse(),
          nextCursor: hasMore ? page[page.length - 1]?.id || null : null,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:userId/messages", async (req, res, next) => {
    try {
      const senderId = (req as AuthenticatedRequest).user!.id;
      const { userId: receiverId } = parseOrThrow(
        userParamsSchema.safeParse(req.params)
      );
      const { content } = parseOrThrow(
        sendPrivateMessageSchema.safeParse(req.body)
      );
      if (senderId === receiverId) {
        throw new AppError("You cannot message yourself", 400);
      }

      const receiver = await prisma.user.findUnique({
        where: { id: receiverId },
        select: { id: true },
      });
      if (!receiver) throw new AppError("User not found", 404);

      const message = await prisma.privateMessage.create({
        data: {
          senderId,
          receiverId,
          content,
          type: "TEXT",
        },
        select: privateMessageSelect,
      });

      return res.status(201).json({
        success: true,
        data: { message },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:userId/read", async (req, res, next) => {
    try {
      const receiverId = (req as AuthenticatedRequest).user!.id;
      const { userId: senderId } = parseOrThrow(
        userParamsSchema.safeParse(req.params)
      );
      if (receiverId === senderId) {
        throw new AppError("Private conversations require another user", 400);
      }

      const result = await prisma.privateMessage.updateMany({
        where: {
          senderId,
          receiverId,
          isRead: false,
        },
        data: { isRead: true },
      });

      return res.json({
        success: true,
        data: { updatedCount: result.count },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createPrivateMessagesRouter();
