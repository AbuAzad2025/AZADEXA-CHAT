import { Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router: Router = Router();
const prisma = new PrismaClient();
const MAX_JOIN_ATTEMPTS = 3;

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
router.post("/rooms/:roomId/join", authenticate, async (req, res, next) => {
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
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
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
});

// POST /api/v1/chat/rooms/:roomId/leave
router.post("/rooms/:roomId/leave", authenticate, async (req, res, next) => {
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
});

export default router;
