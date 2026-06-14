import assert from "node:assert/strict";
import { Server } from "http";
import { after, before, describe, it } from "node:test";
import express, { RequestHandler } from "express";
import {
  PrismaClient,
  ReportStatus,
  ReportType,
  UserRole,
} from "@prisma/client";
import { AuthenticatedRequest, requireRole } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import { createAdminRouter } from "./admin";
import { createReportsRouter } from "./reports";

interface TestUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  avatar: null;
  createdAt: Date;
}

interface FakeReport {
  id: string;
  reporterId: string;
  reportedId: string;
  type: ReportType;
  reason: string;
  evidence: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface TestApiResponse {
  success: boolean;
  error?: string;
  data?: {
    report?: {
      id: string;
      status: ReportStatus;
      resolvedBy?: string | null;
      resolution?: string | null;
    };
    reports?: { id: string; status: ReportStatus }[];
    counts?: Record<ReportStatus, number>;
    open?: number;
  };
}

const reporter: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm580",
  email: "reporter@example.com",
  username: "reporter",
  role: "USER",
  avatar: null,
  createdAt: new Date("2026-06-14T00:00:00.000Z"),
};
const reported: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm581",
  email: "reported@example.com",
  username: "reported",
  role: "USER",
  avatar: null,
  createdAt: new Date("2026-06-13T00:00:00.000Z"),
};
const moderator: TestUser = {
  id: "cmqd06xfa0000cn13o3jjm582",
  email: "moderator@example.com",
  username: "moderator",
  role: "MODERATOR",
  avatar: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
};

const users = new Map(
  [reporter, reported, moderator].map((user) => [user.id, user])
);
let storedReport: FakeReport | null = null;
let activeUser = reporter;

const userFacingReport = (report: FakeReport) => ({
  ...report,
  reported: users.get(report.reportedId),
});

const adminFacingReport = (report: FakeReport) => ({
  ...report,
  reporter: users.get(report.reporterId),
  reported: users.get(report.reportedId),
});

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const user = users.get(where.id);
      return user ? { id: user.id } : null;
    },
  },
  report: {
    findFirst: async ({
      where,
    }: {
      where: {
        reporterId: string;
        reportedId: string;
        status: { in: ReportStatus[] };
      };
    }) => {
      if (
        storedReport &&
        storedReport.reporterId === where.reporterId &&
        storedReport.reportedId === where.reportedId &&
        where.status.in.includes(storedReport.status)
      ) {
        return { id: storedReport.id };
      }
      return null;
    },
    create: async ({
      data,
    }: {
      data: {
        reporterId: string;
        reportedId: string;
        type: ReportType;
        reason: string;
        evidence: string | null;
      };
    }) => {
      storedReport = {
        id: "cmqd06xfa0000cn13o3jjm590",
        ...data,
        status: "PENDING",
        resolvedBy: null,
        resolution: null,
        createdAt: new Date(),
        resolvedAt: null,
      };
      return userFacingReport(storedReport);
    },
    findMany: async ({
      where,
    }: {
      where: {
        reporterId?: string;
        status?: ReportStatus;
        type?: ReportType;
      };
    }) => {
      if (!storedReport) return [];
      if (where.reporterId && where.reporterId !== storedReport.reporterId) {
        return [];
      }
      if (where.status && where.status !== storedReport.status) return [];
      if (where.type && where.type !== storedReport.type) return [];
      return where.reporterId
        ? [userFacingReport(storedReport)]
        : [adminFacingReport(storedReport)];
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (!storedReport || storedReport.id !== where.id) return null;
      return adminFacingReport(storedReport);
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: {
        status: ReportStatus;
        resolution: string | null;
        resolvedBy: string | null;
        resolvedAt: Date | null;
      };
    }) => {
      if (!storedReport || storedReport.id !== where.id) {
        throw new Error("Report missing");
      }
      storedReport = { ...storedReport, ...data };
      return adminFacingReport(storedReport);
    },
    groupBy: async () => {
      if (!storedReport) return [];
      return [
        {
          status: storedReport.status,
          _count: { _all: 1 },
        },
      ];
    },
  },
} as unknown as PrismaClient;

const testAuthenticate: RequestHandler = (req, _res, next) => {
  (req as AuthenticatedRequest).user = activeUser;
  next();
};

const app = express();
app.use(express.json());
app.use(
  "/api/v1/reports",
  createReportsRouter({
    prisma: fakePrisma,
    authenticateMiddleware: testAuthenticate,
  })
);
app.use(
  "/api/v1/admin",
  createAdminRouter({
    prisma: fakePrisma,
    authenticateMiddleware: testAuthenticate,
    moderatorMiddleware: requireRole("MODERATOR", "ADMIN", "SUPER_ADMIN"),
  })
);
app.use(errorHandler);

let server: Server;
let baseUrl = "";

const apiRequest = async (
  route: string,
  options: { method?: string; body?: object } = {}
): Promise<{ status: number; body: TestApiResponse }> => {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: (await response.json()) as TestApiResponse,
  };
};

describe("Report and moderation routes", () => {
  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Test server did not expose a TCP port");
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("validates and creates a user report without allowing duplicates", async () => {
    activeUser = reporter;

    const selfReport = await apiRequest("/api/v1/reports", {
      method: "POST",
      body: {
        reportedUserId: reporter.id,
        type: "HARASSMENT",
        reason: "A sufficiently detailed report reason",
      },
    });
    assert.equal(selfReport.status, 400);

    const missingUser = await apiRequest("/api/v1/reports", {
      method: "POST",
      body: {
        reportedUserId: "cmqd06xfa0000cn13o3jjm589",
        type: "SPAM",
        reason: "Repeated unsolicited messages in the public room",
      },
    });
    assert.equal(missingUser.status, 404);

    const created = await apiRequest("/api/v1/reports", {
      method: "POST",
      body: {
        reportedUserId: reported.id,
        type: "HARASSMENT",
        reason: "Repeated personal attacks in a public conversation",
        evidence: "message-id: test-message",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data?.report?.status, "PENDING");

    const duplicate = await apiRequest("/api/v1/reports", {
      method: "POST",
      body: {
        reportedUserId: reported.id,
        type: "SPAM",
        reason: "A second active report should not be accepted",
      },
    });
    assert.equal(duplicate.status, 409);

    const mine = await apiRequest("/api/v1/reports/mine");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data?.reports?.length, 1);
  });

  it("protects the moderation queue and enforces report transitions", async () => {
    activeUser = reporter;
    const forbidden = await apiRequest("/api/v1/admin/reports/summary");
    assert.equal(forbidden.status, 403);

    activeUser = moderator;
    const summary = await apiRequest("/api/v1/admin/reports/summary");
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data?.counts?.PENDING, 1);
    assert.equal(summary.body.data?.open, 1);

    const list = await apiRequest("/api/v1/admin/reports?status=PENDING");
    assert.equal(list.status, 200);
    assert.equal(list.body.data?.reports?.length, 1);

    const invalidCursor = await apiRequest(
      "/api/v1/admin/reports?before=cmqd06xfa0000cn13o3jjm599"
    );
    assert.equal(invalidCursor.status, 400);

    const missingResolution = await apiRequest(
      `/api/v1/admin/reports/${storedReport?.id}`,
      {
        method: "PATCH",
        body: { status: "RESOLVED" },
      }
    );
    assert.equal(missingResolution.status, 400);

    const reviewing = await apiRequest(
      `/api/v1/admin/reports/${storedReport?.id}`,
      {
        method: "PATCH",
        body: { status: "UNDER_REVIEW" },
      }
    );
    assert.equal(reviewing.status, 200);
    assert.equal(reviewing.body.data?.report?.status, "UNDER_REVIEW");

    const resolved = await apiRequest(
      `/api/v1/admin/reports/${storedReport?.id}`,
      {
        method: "PATCH",
        body: {
          status: "RESOLVED",
          resolution: "Reviewed the evidence and issued a warning.",
        },
      }
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data?.report?.status, "RESOLVED");
    assert.equal(resolved.body.data?.report?.resolvedBy, moderator.id);

    const closed = await apiRequest(
      `/api/v1/admin/reports/${storedReport?.id}`,
      {
        method: "PATCH",
        body: {
          status: "DISMISSED",
          resolution: "Trying to change a closed report",
        },
      }
    );
    assert.equal(closed.status, 409);
  });
});
