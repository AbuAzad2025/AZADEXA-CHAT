import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { io } from "socket.io-client";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(apiDirectory, "../..");

dotenv.config({ path: path.join(repositoryRoot, ".env") });
dotenv.config();

const prisma = new PrismaClient();
const clients = [];
const runPrefix = `load_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
const userCount = Number.parseInt(process.env.LOAD_TEST_USERS || "100", 10);
const latencyLimitMs = Number.parseInt(
  process.env.LOAD_TEST_P95_LIMIT_MS || "200",
  10,
);
const sendConcurrency = Number.parseInt(
  process.env.LOAD_TEST_SEND_CONCURRENCY || "5",
  10,
);
const port = Number.parseInt(process.env.LOAD_TEST_PORT || "4011", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const serverEntry = path.join(apiDirectory, "dist/server.js");

let serverProcess;
let serverOutput = "";
let roomId;

const assertConfiguration = () => {
  if (process.env.LOAD_TEST_CONFIRM !== "yes") {
    throw new Error(
      "Set LOAD_TEST_CONFIRM=yes to acknowledge temporary database writes.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("The load test refuses to run with NODE_ENV=production.");
  }
  if (!Number.isInteger(userCount) || userCount < 1 || userCount > 500) {
    throw new Error("LOAD_TEST_USERS must be an integer between 1 and 500.");
  }
  if (!Number.isInteger(latencyLimitMs) || latencyLimitMs < 1) {
    throw new Error("LOAD_TEST_P95_LIMIT_MS must be a positive integer.");
  }
  if (
    !Number.isInteger(sendConcurrency) ||
    sendConcurrency < 1 ||
    sendConcurrency > userCount
  ) {
    throw new Error(
      "LOAD_TEST_SEND_CONCURRENCY must be between 1 and LOAD_TEST_USERS.",
    );
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("LOAD_TEST_PORT must be between 1024 and 65535.");
  }
  if (!existsSync(serverEntry)) {
    throw new Error(
      "API build not found. Run pnpm --filter @zestchat/api run build first.",
    );
  }
};

const percentile = (values, percentage) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentage / 100) * sorted.length) - 1;
  return Number(sorted[Math.max(index, 0)].toFixed(2));
};

const summarize = (values) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: Number(Math.max(...values).toFixed(2)),
});

const appendServerOutput = (chunk) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
};

const startServer = () => {
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProcess.stdout.on("data", appendServerOutput);
  serverProcess.stderr.on("data", appendServerOutput);
};

const waitForReadiness = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`API exited before readiness:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) return;
    } catch {
      // The server may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API readiness timed out:\n${serverOutput}`);
};

const stopServer = async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
};

const generateToken = (userId) => {
  const secret = process.env.JWT_SECRET?.trim() || "change-me-in-production";
  return jwt.sign({ userId, jti: randomUUID() }, secret, {
    expiresIn: "15m",
  });
};

const createFixtures = async () => {
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, index) =>
      prisma.user.create({
        data: {
          email: `${runPrefix}.${index}@load.invalid`,
          username: `${runPrefix}_${index}`,
          passwordHash: "load-test-not-a-real-password-hash",
        },
        select: { id: true },
      }),
    ),
  );

  const room = await prisma.room.create({
    data: {
      name: `Load Test ${runPrefix}`,
      slug: `${runPrefix}-room`,
      type: "PUBLIC",
      maxUsers: userCount,
      createdBy: users[0].id,
    },
    select: { id: true },
  });
  roomId = room.id;

  const sessions = users.map(({ id }) => ({
    userId: id,
    token: generateToken(id),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
  }));

  await Promise.all([
    prisma.roomMember.createMany({
      data: users.map(({ id }) => ({
        roomId: room.id,
        userId: id,
        role: "MEMBER",
      })),
    }),
    prisma.session.createMany({ data: sessions }),
  ]);

  return sessions;
};

const connectClient = (token) =>
  new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const client = io(baseUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      timeout: 10_000,
    });
    clients.push(client);

    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error("Timed out connecting a load-test client."));
    }, 15_000);

    client.once("connect", () => {
      clearTimeout(timer);
      resolve({ client, latency: performance.now() - startedAt });
    });
    client.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const emitWithAck = (client, event, payload, timeoutMs = 15_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Timed out waiting for ${event} acknowledgement.`)),
      timeoutMs,
    );
    client.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (!response?.success) {
        reject(new Error(response?.error || `${event} failed.`));
        return;
      }
      resolve(response.data);
    });
  });

const sendMeasuredMessage = (client, index) =>
  new Promise((resolve, reject) => {
    const content = `${runPrefix}:message:${index}`;
    const startedAt = performance.now();
    let acknowledgementLatency;
    let deliveryLatency;

    const timer = setTimeout(() => {
      client.off("message:new", onMessage);
      reject(new Error(`Timed out delivering message ${index}.`));
    }, 15_000);

    const finishIfComplete = () => {
      if (
        acknowledgementLatency === undefined ||
        deliveryLatency === undefined
      ) {
        return;
      }
      clearTimeout(timer);
      client.off("message:new", onMessage);
      resolve({ acknowledgementLatency, deliveryLatency });
    };

    const onMessage = (message) => {
      if (message?.content !== content) return;
      deliveryLatency = performance.now() - startedAt;
      finishIfComplete();
    };

    client.on("message:new", onMessage);
    client.emit("message:send", { roomId, content }, (response) => {
      if (!response?.success) {
        clearTimeout(timer);
        client.off("message:new", onMessage);
        reject(new Error(response?.error || `Message ${index} failed.`));
        return;
      }
      acknowledgementLatency = performance.now() - startedAt;
      finishIfComplete();
    });
  });

const cleanupFixtures = async () => {
  if (roomId) {
    await prisma.room.deleteMany({ where: { id: roomId } });
  }
  await prisma.user.deleteMany({
    where: { email: { startsWith: `${runPrefix}.` } },
  });
};

const run = async () => {
  assertConfiguration();
  const sessions = await createFixtures();
  startServer();
  await waitForReadiness();

  const connected = await Promise.all(
    sessions.map(({ token }) => connectClient(token)),
  );
  await Promise.all(
    connected.map(({ client }) => emitWithAck(client, "room:join", { roomId })),
  );

  const measured = [];
  for (let offset = 0; offset < connected.length; offset += sendConcurrency) {
    const batch = connected.slice(offset, offset + sendConcurrency);
    measured.push(
      ...(await Promise.all(
        batch.map(({ client }, index) =>
          sendMeasuredMessage(client, offset + index),
        ),
      )),
    );
  }

  const result = {
    users: userCount,
    messages: measured.length,
    sendConcurrency,
    connectionMs: summarize(connected.map(({ latency }) => latency)),
    acknowledgementMs: summarize(
      measured.map(({ acknowledgementLatency }) => acknowledgementLatency),
    ),
    deliveryMs: summarize(
      measured.map(({ deliveryLatency }) => deliveryLatency),
    ),
    p95LimitMs: latencyLimitMs,
  };
  console.log(JSON.stringify(result, null, 2));

  if (result.deliveryMs.p95 >= latencyLimitMs) {
    throw new Error(
      `Delivery P95 ${result.deliveryMs.p95}ms exceeded ${latencyLimitMs}ms.`,
    );
  }
};

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  clients.forEach((client) => client.disconnect());
  await stopServer();
  try {
    await cleanupFixtures();
  } finally {
    await prisma.$disconnect();
  }
}
