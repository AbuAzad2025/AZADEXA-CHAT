import { RequestHandler, Router } from "express";
import { Prisma, PrismaClient, ReportType } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const reportTypes = [
  "SPAM",
  "HARASSMENT",
  "HATE_SPEECH",
  "INAPPROPRIATE_CONTENT",
  "IMPERSONATION",
  "SCAM",
  "OTHER",
] as const satisfies readonly ReportType[];

const createReportSchema = z.object({
  reportedUserId: z.string().cuid(),
  type: z.enum(reportTypes),
  reason: z.string().trim().min(10).max(1000),
  evidence: z.string().trim().max(2000).optional(),
});

interface ReportsRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
}

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || "Invalid request", 400);
  }
  return result.data;
};

const reportSelect = {
  id: true,
  type: true,
  reason: true,
  evidence: true,
  status: true,
  resolution: true,
  createdAt: true,
  resolvedAt: true,
  reported: {
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  },
} satisfies Prisma.ReportSelect;

export const createReportsRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
}: ReportsRouterDependencies = {}): Router => {
  const router = Router();

  router.get("/mine", authenticateMiddleware, async (req, res, next) => {
    try {
      const reporterId = (req as AuthenticatedRequest).user!.id;
      const reports = await prisma.report.findMany({
        where: { reporterId },
        select: reportSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      });

      return res.json({
        success: true,
        data: { reports },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/", authenticateMiddleware, async (req, res, next) => {
    try {
      const reporterId = (req as AuthenticatedRequest).user!.id;
      const { reportedUserId, type, reason, evidence } = parseOrThrow(
        createReportSchema.safeParse(req.body)
      );
      if (reportedUserId === reporterId) {
        throw new AppError("You cannot report yourself", 400);
      }

      const reportedUser = await prisma.user.findUnique({
        where: { id: reportedUserId },
        select: { id: true },
      });
      if (!reportedUser) throw new AppError("Reported user not found", 404);

      const existingReport = await prisma.report.findFirst({
        where: {
          reporterId,
          reportedId: reportedUserId,
          status: { in: ["PENDING", "UNDER_REVIEW"] },
        },
        select: { id: true },
      });
      if (existingReport) {
        throw new AppError("You already have an active report for this user", 409);
      }

      const report = await prisma.report.create({
        data: {
          reporterId,
          reportedId: reportedUserId,
          type,
          reason,
          evidence: evidence || null,
        },
        select: reportSelect,
      });

      return res.status(201).json({
        success: true,
        data: { report },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createReportsRouter();
