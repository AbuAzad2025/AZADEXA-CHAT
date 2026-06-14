import { RequestHandler, Router } from "express";
import {
  Prisma,
  PrismaClient,
  ReportStatus,
  ReportType,
} from "@prisma/client";
import { z } from "zod";
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
} from "../middleware/auth";
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

const reportStatuses = [
  "PENDING",
  "UNDER_REVIEW",
  "RESOLVED",
  "DISMISSED",
] as const satisfies readonly ReportStatus[];

const finalStatuses = new Set<ReportStatus>(["RESOLVED", "DISMISSED"]);
const allowedTransitions: Record<ReportStatus, ReportStatus[]> = {
  PENDING: ["UNDER_REVIEW", "RESOLVED", "DISMISSED"],
  UNDER_REVIEW: ["RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};

const reportListSchema = z.object({
  status: z.enum(reportStatuses).optional(),
  type: z.enum(reportTypes).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().cuid().optional(),
});

const reportParamsSchema = z.object({
  reportId: z.string().cuid(),
});

const updateReportSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
    resolution: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.status === "RESOLVED" || value.status === "DISMISSED") &&
      (!value.resolution || value.resolution.length < 5)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution"],
        message: "A resolution of at least 5 characters is required",
      });
    }
  });

interface AdminRouterDependencies {
  prisma?: PrismaClient;
  authenticateMiddleware?: RequestHandler;
  moderatorMiddleware?: RequestHandler;
}

const parseOrThrow = <T>(result: z.SafeParseReturnType<unknown, T>): T => {
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || "Invalid request", 400);
  }
  return result.data;
};

const adminReportSelect = {
  id: true,
  type: true,
  reason: true,
  evidence: true,
  status: true,
  resolvedBy: true,
  resolution: true,
  createdAt: true,
  resolvedAt: true,
  reporter: {
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  },
  reported: {
    select: {
      id: true,
      username: true,
      avatar: true,
      role: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ReportSelect;

export const createAdminRouter = ({
  prisma = new PrismaClient(),
  authenticateMiddleware = authenticate,
  moderatorMiddleware = requireRole("MODERATOR", "ADMIN", "SUPER_ADMIN"),
}: AdminRouterDependencies = {}): Router => {
  const router = Router();

  router.use(authenticateMiddleware, moderatorMiddleware);

  router.get("/reports/summary", async (_req, res, next) => {
    try {
      const grouped = await prisma.report.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      const counts = reportStatuses.reduce<Record<ReportStatus, number>>(
        (result, status) => {
          result[status] =
            grouped.find((entry) => entry.status === status)?._count._all || 0;
          return result;
        },
        {
          PENDING: 0,
          UNDER_REVIEW: 0,
          RESOLVED: 0,
          DISMISSED: 0,
        }
      );

      return res.json({
        success: true,
        data: {
          counts,
          open: counts.PENDING + counts.UNDER_REVIEW,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/reports", async (req, res, next) => {
    try {
      const { status, type, limit, before } = parseOrThrow(
        reportListSchema.safeParse(req.query)
      );
      const beforeReport = before
        ? await prisma.report.findUnique({
            where: { id: before },
            select: { id: true, createdAt: true },
          })
        : null;
      if (before && !beforeReport) {
        throw new AppError("Invalid report cursor", 400);
      }

      const reports = await prisma.report.findMany({
        where: {
          ...(status && { status }),
          ...(type && { type }),
          ...(beforeReport && {
            OR: [
              { createdAt: { lt: beforeReport.createdAt } },
              {
                createdAt: beforeReport.createdAt,
                id: { lt: beforeReport.id },
              },
            ],
          }),
        },
        select: adminReportSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasMore = reports.length > limit;
      const page = hasMore ? reports.slice(0, limit) : reports;

      return res.json({
        success: true,
        data: {
          reports: page,
          nextCursor: hasMore ? page[page.length - 1]?.id || null : null,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/reports/:reportId", async (req, res, next) => {
    try {
      const { reportId } = parseOrThrow(
        reportParamsSchema.safeParse(req.params)
      );
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: adminReportSelect,
      });
      if (!report) throw new AppError("Report not found", 404);

      return res.json({
        success: true,
        data: { report },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/reports/:reportId", async (req, res, next) => {
    try {
      const moderatorId = (req as AuthenticatedRequest).user!.id;
      const { reportId } = parseOrThrow(
        reportParamsSchema.safeParse(req.params)
      );
      const { status, resolution } = parseOrThrow(
        updateReportSchema.safeParse(req.body)
      );
      const existingReport = await prisma.report.findUnique({
        where: { id: reportId },
        select: { id: true, status: true },
      });
      if (!existingReport) throw new AppError("Report not found", 404);
      if (!allowedTransitions[existingReport.status].includes(status)) {
        throw new AppError(
          finalStatuses.has(existingReport.status)
            ? "Closed reports cannot be changed"
            : `Cannot move report from ${existingReport.status} to ${status}`,
          409
        );
      }

      const isFinal = finalStatuses.has(status);
      const report = await prisma.report.update({
        where: { id: reportId },
        data: {
          status,
          resolution: resolution || null,
          resolvedBy: isFinal ? moderatorId : null,
          resolvedAt: isFinal ? new Date() : null,
        },
        select: adminReportSelect,
      });

      return res.json({
        success: true,
        data: { report },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createAdminRouter();
