import { RequestHandler, Router } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authRateLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import { disconnectSessionSockets } from "../websocket/socket";

const getSessionExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).+$/),
  birthDate: z.string().datetime().optional(),
  language: z.string().default("en"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface AuthRouterDependencies {
  prisma?: PrismaClient;
  loginRateLimiter?: RequestHandler;
  disconnectSession?: (sessionId: string) => void;
  hashPassword?: (password: string) => Promise<string>;
  comparePassword?: (password: string, hash: string) => Promise<boolean>;
}

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(
      result.error.issues[0]?.message || "Invalid request",
      400,
    );
  }
  return result.data;
};

export const createAuthRouter = ({
  prisma = new PrismaClient(),
  loginRateLimiter = authRateLimiter,
  disconnectSession = disconnectSessionSockets,
  hashPassword = (password) => bcrypt.hash(password, 12),
  comparePassword = bcrypt.compare,
}: AuthRouterDependencies = {}): Router => {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const data = parseOrThrow(registerSchema.safeParse(req.body));

      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email: data.email }, { username: data.username }] },
      });
      if (existingUser)
        throw new AppError("Email or username already exists", 409);

      const passwordHash = await hashPassword(data.password);

      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash,
          language: data.language,
          birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
          profile: { create: {} },
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
        },
      });

      const accessToken = generateToken(user.id);
      const refreshToken = generateRefreshToken(user.id);

      await prisma.session.create({
        data: {
          userId: user.id,
          token: accessToken,
          refreshToken,
          expiresAt: getSessionExpiry(),
        },
      });

      res.status(201).json({
        success: true,
        data: { user, accessToken, refreshToken },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", loginRateLimiter, async (req, res, next) => {
    try {
      const data = parseOrThrow(loginSchema.safeParse(req.body));

      const user = await prisma.user.findUnique({
        where: { email: data.email },
      });
      if (!user) throw new AppError("Invalid credentials", 401);

      const valid = await comparePassword(data.password, user.passwordHash);
      if (!valid) throw new AppError("Invalid credentials", 401);

      if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
        // Could add 2FA check here
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { status: "ONLINE" },
      });

      const accessToken = generateToken(user.id);
      const refreshToken = generateRefreshToken(user.id);

      await prisma.session.create({
        data: {
          userId: user.id,
          token: accessToken,
          refreshToken,
          expiresAt: getSessionExpiry(),
        },
      });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            status: "ONLINE",
          },
          accessToken,
          refreshToken,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) throw new AppError("Refresh token required", 400);

      let payload;
      try {
        payload = verifyRefreshToken(refreshToken);
      } catch {
        throw new AppError("Invalid refresh token", 401);
      }
      if (typeof payload.userId !== "string") {
        throw new AppError("Invalid refresh token", 401);
      }

      const session = await prisma.session.findFirst({
        where: {
          refreshToken,
          userId: payload.userId,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) throw new AppError("Invalid refresh token", 401);

      const newAccessToken = generateToken(payload.userId);
      const newRefreshToken = generateRefreshToken(payload.userId);

      await prisma.session.update({
        where: { id: session.id },
        data: { token: newAccessToken, refreshToken: newRefreshToken },
      });
      disconnectSession(session.id);

      res.json({
        success: true,
        data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Bearer ", "");
      if (token) {
        const sessions = await prisma.session.findMany({
          where: { token },
          select: { id: true },
        });
        await prisma.session.deleteMany({ where: { token } });
        sessions.forEach(({ id }) => disconnectSession(id));
      }
      res.json({ success: true, message: "Logged out successfully" });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default createAuthRouter();
