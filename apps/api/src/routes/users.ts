import { RequestHandler, Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const searchUsersSchema = z.object({
  q: z.string().trim().min(2).max(30),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();

const updateProfileSchema = z
  .object({
    displayName: nullableText(50),
    bio: nullableText(280),
    activity: nullableText(80),
    language: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[a-zA-Z]+(?:-[a-zA-Z]+)?$/)
      .optional(),
    country: z
      .union([
        z
          .string()
          .trim()
          .length(2)
          .regex(/^[a-zA-Z]{2}$/),
        z.null(),
      ])
      .transform((value) =>
        typeof value === "string" ? value.toUpperCase() : null,
      )
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one profile field is required",
  });

const userProfileSelect = {
  id: true,
  email: true,
  username: true,
  avatar: true,
  language: true,
  country: true,
  status: true,
  role: true,
  emailVerified: true,
  createdAt: true,
  profile: {
    select: {
      displayName: true,
      bio: true,
      activity: true,
      theme: true,
      subscriptionTier: true,
    },
  },
} as const;

interface UsersRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
}

export const createUsersRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
}: UsersRouterDependencies = {}): Router => {
  const router = Router();

  router.get("/me", authenticateMiddleware, async (req, res, next) => {
    try {
      const userId = (req as AuthenticatedRequest).user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: userProfileSelect,
      });
      if (!user) throw new AppError("User not found", 404);

      return res.json({ success: true, data: { user } });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/me", authenticateMiddleware, async (req, res, next) => {
    try {
      const result = updateProfileSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(
          result.error.issues[0]?.message || "Invalid profile",
          400,
        );
      }

      const userId = (req as AuthenticatedRequest).user!.id;
      const { displayName, bio, activity, language, country } = result.data;
      const profileData = {
        ...(displayName !== undefined && { displayName }),
        ...(bio !== undefined && { bio }),
        ...(activity !== undefined && { activity }),
      };

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(language !== undefined && { language }),
          ...(country !== undefined && { country }),
          ...(Object.keys(profileData).length > 0 && {
            profile: {
              upsert: {
                create: profileData,
                update: profileData,
              },
            },
          }),
        },
        select: userProfileSelect,
      });

      return res.json({ success: true, data: { user } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/search", authenticateMiddleware, async (req, res, next) => {
    try {
      const result = searchUsersSchema.safeParse(req.query);
      if (!result.success) {
        throw new AppError(
          result.error.issues[0]?.message || "Invalid search",
          400,
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
