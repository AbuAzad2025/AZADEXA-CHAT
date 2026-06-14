import { Router } from "express";

interface HealthRouterDependencies {
  checkReadiness: () => Promise<void>;
  now?: () => Date;
}

export const createHealthRouter = ({
  checkReadiness,
  now = () => new Date(),
}: HealthRouterDependencies): Router => {
  const router = Router();

  router.get("/health", (_req, res) => {
    return res.json({
      status: "ok",
      timestamp: now().toISOString(),
    });
  });

  router.get("/ready", async (_req, res) => {
    try {
      await checkReadiness();
      return res.json({
        status: "ready",
        timestamp: now().toISOString(),
      });
    } catch {
      return res.status(503).json({
        status: "unavailable",
        timestamp: now().toISOString(),
      });
    }
  });

  return router;
};
