import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { createServer } from "http";
import { PrismaClient } from "@prisma/client";

import { setupWebSocket } from "./websocket/socket";
import { errorHandler } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimit";

import authRoutes from "./routes/auth";
import chatRoutes from "./routes/chat";
import userRoutes from "./routes/users";
import adminRoutes from "./routes/admin";
import aiRoutes from "./routes/ai";
import mediaRoutes from "./routes/media";

import { logger } from "./utils/logger";

const envPath = path.resolve(process.cwd(), "../../.env");
dotenv.config({ path: envPath });
dotenv.config();

const app = express();
const server = createServer(app);
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(rateLimiter);

app.use("/uploads", express.static("uploads"));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/media", mediaRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(errorHandler);

setupWebSocket(server, prisma);

server.listen(PORT, () => {
  logger.info(`ZestChat API server running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await prisma.$disconnect();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
