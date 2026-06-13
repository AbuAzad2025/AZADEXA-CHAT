import { RequestHandler, Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  findConfiguredBlockedTerm,
  OpenAIZestyProvider,
  ZESTY_BLOCKED_PLACEHOLDER,
  ZESTY_DAILY_MESSAGE_LIMIT,
  ZESTY_SAFE_FALLBACK,
  ZestyMessage,
  ZestyProvider,
} from "../services/zesty";

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().cuid().optional(),
});

const conversationParamsSchema = z.object({
  conversationId: z.string().cuid(),
});

const MAX_CONTEXT_MESSAGES = 12;
const MAX_STORED_MESSAGES = 100;

interface AiRouterDependencies {
  prisma?: PrismaClient;
  provider?: ZestyProvider;
  authenticateMiddleware?: RequestHandler;
}

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || "Invalid request", 400);
  }
  return result.data;
};

export const parseStoredMessages = (value: Prisma.JsonValue): ZestyMessage[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      typeof item.createdAt !== "string"
    ) {
      return [];
    }

    return [
      {
        role: item.role,
        content: item.content,
        createdAt: item.createdAt,
        ...(item.blocked === true && { blocked: true }),
      },
    ];
  });
};

export const countMessagesSince = (
  conversations: { messages: Prisma.JsonValue }[],
  since: Date
): number =>
  conversations.reduce(
    (total, conversation) =>
      total +
      parseStoredMessages(conversation.messages).filter(
        (message) =>
          message.role === "user" &&
          Number.isFinite(Date.parse(message.createdAt)) &&
          new Date(message.createdAt) >= since
      ).length,
    0
  );

const asInputJson = (messages: ZestyMessage[]): Prisma.InputJsonValue =>
  messages as unknown as Prisma.InputJsonValue;

const trimStoredMessages = (messages: ZestyMessage[]): ZestyMessage[] =>
  messages.slice(-MAX_STORED_MESSAGES);

const startOfUtcDay = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const createAiRouter = ({
  prisma = new PrismaClient(),
  provider = new OpenAIZestyProvider(),
  authenticateMiddleware = authenticate,
}: AiRouterDependencies = {}): Router => {
  const router = Router();

  router.get("/status", authenticateMiddleware, (_req, res) => {
    return res.json({
      success: true,
      data: {
        configured: provider.isConfigured(),
        dailyMessageLimit: ZESTY_DAILY_MESSAGE_LIMIT,
      },
    });
  });

  router.get("/conversations", authenticateMiddleware, async (req, res, next) => {
    try {
      const userId = (req as AuthenticatedRequest).user!.id;
      const conversations = await prisma.aIConversation.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          messages: true,
          flaggedContent: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({
        success: true,
        data: {
          conversations: conversations.map((conversation) => {
            const messages = parseStoredMessages(conversation.messages);
            const latestMessage = messages[messages.length - 1];
            return {
              id: conversation.id,
              flaggedContent: conversation.flaggedContent,
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
              messageCount: messages.length,
              preview: latestMessage?.content || null,
            };
          }),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    "/conversations/:conversationId",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const userId = (req as AuthenticatedRequest).user!.id;
        const { conversationId } = parseOrThrow(
          conversationParamsSchema.safeParse(req.params)
        );
        const conversation = await prisma.aIConversation.findFirst({
          where: { id: conversationId, userId },
        });
        if (!conversation) throw new AppError("Conversation not found", 404);

        return res.json({
          success: true,
          data: {
            conversation: {
              ...conversation,
              messages: parseStoredMessages(conversation.messages),
            },
          },
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.delete(
    "/conversations/:conversationId",
    authenticateMiddleware,
    async (req, res, next) => {
      try {
        const userId = (req as AuthenticatedRequest).user!.id;
        const { conversationId } = parseOrThrow(
          conversationParamsSchema.safeParse(req.params)
        );
        const result = await prisma.aIConversation.deleteMany({
          where: { id: conversationId, userId },
        });
        if (result.count === 0) throw new AppError("Conversation not found", 404);

        return res.json({
          success: true,
          data: { deleted: true },
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.post("/chat", authenticateMiddleware, async (req, res, next) => {
    try {
      const userId = (req as AuthenticatedRequest).user!.id;
      const { message, conversationId } = parseOrThrow(
        chatRequestSchema.safeParse(req.body)
      );

      const userConversations = await prisma.aIConversation.findMany({
        where: { userId },
        select: { messages: true },
      });
      const messagesUsedToday = countMessagesSince(userConversations, startOfUtcDay());
      if (messagesUsedToday >= ZESTY_DAILY_MESSAGE_LIMIT) {
        throw new AppError(
          `Daily Zesty limit reached. Try again tomorrow.`,
          429
        );
      }

      const existingConversation = conversationId
        ? await prisma.aIConversation.findFirst({
            where: { id: conversationId, userId },
          })
        : null;
      if (conversationId && !existingConversation) {
        throw new AppError("Conversation not found", 404);
      }

      const existingMessages = existingConversation
        ? parseStoredMessages(existingConversation.messages)
        : [];
      const now = new Date().toISOString();
      const configuredBlockedTerm = findConfiguredBlockedTerm(message);
      const inputModeration = configuredBlockedTerm
        ? { flagged: true, categories: ["configured-blocked-term"] }
        : await provider.moderate(message);

      if (inputModeration.flagged) {
        const blockedMessages = trimStoredMessages([
          ...existingMessages,
          {
            role: "user",
            content: ZESTY_BLOCKED_PLACEHOLDER,
            createdAt: now,
            blocked: true,
          },
        ]);
        const conversation = existingConversation
          ? await prisma.aIConversation.update({
              where: { id: existingConversation.id },
              data: {
                messages: asInputJson(blockedMessages),
                flaggedContent: true,
              },
            })
          : await prisma.aIConversation.create({
              data: {
                userId,
                messages: asInputJson(blockedMessages),
                flaggedContent: true,
              },
            });

        return res.status(400).json({
          success: false,
          error: "Message blocked by Safety Shield",
          data: {
            conversationId: conversation.id,
            flagged: true,
            categories: inputModeration.categories,
            remainingMessages: Math.max(
              0,
              ZESTY_DAILY_MESSAGE_LIMIT - messagesUsedToday - 1
            ),
          },
        });
      }

      const userMessage: ZestyMessage = {
        role: "user",
        content: message,
        createdAt: now,
      };
      const contextMessages = [...existingMessages, userMessage]
        .filter((storedMessage) => !storedMessage.blocked)
        .slice(-MAX_CONTEXT_MESSAGES)
        .map(({ role, content }) => ({ role, content }));
      const generatedReply = await provider.generateReply(contextMessages, userId);
      const outputModeration = await provider.moderate(generatedReply);
      const assistantMessage: ZestyMessage = {
        role: "assistant",
        content: outputModeration.flagged ? ZESTY_SAFE_FALLBACK : generatedReply,
        createdAt: new Date().toISOString(),
        ...(outputModeration.flagged && { blocked: true }),
      };
      const updatedMessages = trimStoredMessages([
        ...existingMessages,
        userMessage,
        assistantMessage,
      ]);
      const flaggedContent =
        Boolean(existingConversation?.flaggedContent) || outputModeration.flagged;
      const conversation = existingConversation
        ? await prisma.aIConversation.update({
            where: { id: existingConversation.id },
            data: {
              messages: asInputJson(updatedMessages),
              flaggedContent,
            },
          })
        : await prisma.aIConversation.create({
            data: {
              userId,
              messages: asInputJson(updatedMessages),
              flaggedContent,
            },
          });

      return res.json({
        success: true,
        data: {
          conversation: {
            ...conversation,
            messages: updatedMessages,
          },
          reply: assistantMessage,
          remainingMessages: Math.max(
            0,
            ZESTY_DAILY_MESSAGE_LIMIT - messagesUsedToday - 1
          ),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createAiRouter();
