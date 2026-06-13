import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { AppError } from "./errorHandler";

const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; username: string; role: string };
}

export const authenticate = async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("Authentication required", 401);
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    const session = await prisma.session.findFirst({
      where: { token, userId: payload.userId },
    });
    if (!session) throw new AppError("Session expired", 401);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, username: true, role: true, status: true },
    });
    if (!user) throw new AppError("User not found", 401);

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError("Forbidden: insufficient permissions", 403));
    }
    next();
  };
};
