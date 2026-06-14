import assert from "node:assert/strict";
import { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createHealthRouter } from "./health";

const timestamp = new Date("2026-06-14T16:30:00.000Z");
let databaseReady = true;

const app = express();
app.use(
  createHealthRouter({
    checkReadiness: async () => {
      if (!databaseReady) throw new Error("Database unavailable");
    },
    now: () => timestamp,
  }),
);

let server: Server;
let baseUrl = "";

before(() => {
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start health test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

describe("health routes", () => {
  it("reports liveness without requiring database access", async () => {
    databaseReady = false;
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      timestamp: timestamp.toISOString(),
    });
  });

  it("reports database readiness and returns 503 when unavailable", async () => {
    databaseReady = true;
    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      status: "ready",
      timestamp: timestamp.toISOString(),
    });

    databaseReady = false;
    const unavailable = await fetch(`${baseUrl}/ready`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      status: "unavailable",
      timestamp: timestamp.toISOString(),
    });
  });
});
