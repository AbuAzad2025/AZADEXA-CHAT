import { Request, Response, NextFunction, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { AppError } from "./errorHandler";

const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; username: string; role: string };
}

export const authenticate: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("Authentication required", 401);
    }

    const token = authHeader.substring(7);
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new AppError("Invalid or expired access token", 401);
    }
    if (typeof payload.userId !== "string") {
      throw new AppError("Invalid access token", 401);
    }

    const session = await prisma.session.findFirst({
      where: { token, userId: payload.userId },
    });
    if (!session) throw new AppError("Session expired", 401);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, username: true, role: true, status: true },
    });
    if (!user) throw new AppError("User not found", 401);

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole = (...roles: string[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !roles.includes(user.role)) {
      return next(new AppError("Forbidden: insufficient permissions", 403));
    }
    next();
  };
};
