import { RequestHandler, Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const searchUsersSchema = z.object({
  q: z.string().trim().min(2).max(30),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

interface UsersRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
}

export const createUsersRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
}: UsersRouterDependencies = {}): Router => {
  const router = Router();

  router.get("/search", authenticateMiddleware, async (req, res, next) => {
    try {
      const result = searchUsersSchema.safeParse(req.query);
      if (!result.success) {
        throw new AppError(
          result.error.issues[0]?.message || "Invalid search",
          400
        );
      }
      const currentUserId = (req as AuthenticatedRequest).user!.id;
      const { q, limit } = result.data;
      const users = await prisma.user.findMany({
        where: {
          id: { not: currentUserId },
          username: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          username: true,
          avatar: true,
          status: true,
        },
        orderBy: { username: "asc" },
        take: limit,
      });

      return res.json({
        success: true,
        data: { users },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createUsersRouter();
