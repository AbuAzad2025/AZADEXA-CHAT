import { Router } from "express";

const router: Router = Router();

// TODO: Implement admin routes - Phase 1 MVP
router.all("*", (_req, res) => res.status(501).json({ error: "Not Implemented" }));

export default router;
