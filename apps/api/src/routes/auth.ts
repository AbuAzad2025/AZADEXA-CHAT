import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authRateLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { generateToken, generateRefreshToken, verifyToken } from "../utils/jwt";

const router: Router = Router();
const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).+$/),
  birthDate: z.string().datetime().optional(),
  language: z.string().default("en"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
    });
    if (existingUser) throw new AppError("Email or username already exists", 409);

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash,
        language: data.language,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
        profile: { create: {} },
      },
      select: { id: true, email: true, username: true, role: true, createdAt: true },
    });

    const accessToken = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.session.create({
      data: { userId: user.id, token: accessToken, refreshToken },
    });

    res.status(201).json({
      success: true,
      data: { user, accessToken, refreshToken },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AppError("Invalid credentials", 401);

    const valid = await bcrypt.compare(data.password, user.passwordHash);
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
      data: { userId: user.id, token: accessToken, refreshToken },
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
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

    const payload = verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: string };
    const session = await prisma.session.findFirst({
      where: { refreshToken, userId: payload.userId },
    });
    if (!session) throw new AppError("Invalid refresh token", 401);

    const newAccessToken = generateToken(payload.userId);
    const newRefreshToken = generateRefreshToken(payload.userId);

    await prisma.session.update({
      where: { id: session.id },
      data: { token: newAccessToken, refreshToken: newRefreshToken },
    });

    res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "");
    if (token) {
      await prisma.session.deleteMany({ where: { token } });
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
