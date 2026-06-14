# ZestChat Performance Checks

The MVP acceptance target is 100 concurrent users with message delivery below
200 ms at P95.

## WebSocket Load Test

The API load harness uses the configured local PostgreSQL database. It creates a
temporary public room, users, sessions, memberships, and messages, then removes
all test data before exiting.

Build the API first:

```powershell
pnpm --filter @zestchat/api run build
```

Run the default 100-user test:

```powershell
$env:LOAD_TEST_CONFIRM = "yes"
pnpm --filter @zestchat/api run test:load
Remove-Item Env:LOAD_TEST_CONFIRM
```

Do not run this command against production. The harness refuses to run when
`NODE_ENV=production`, but the operator is still responsible for selecting an
isolated database.

## Configuration

- `LOAD_TEST_USERS`: concurrent users, default `100`, maximum `500`
- `LOAD_TEST_SEND_CONCURRENCY`: simultaneous senders per burst, default `5`
- `LOAD_TEST_P95_LIMIT_MS`: delivery threshold, default `200`
- `LOAD_TEST_PORT`: temporary API port, default `4011`

The report includes P50, P95, P99, and maximum latency for:

- authenticated WebSocket connection establishment
- server acknowledgements after message persistence
- end-to-end message delivery back to the sending client

The command exits with a non-zero status when any connection, room join, send,
or delivery fails, or when delivery P95 reaches the configured limit.

All users remain connected while each user sends one message. The default
traffic profile sends messages in bursts of 5 concurrent writers. Increase
`LOAD_TEST_SEND_CONCURRENCY` to run stricter burst tests; an all-writers-at-once
profile is intentionally heavier than the MVP acceptance target.

## Local MVP Baseline

On June 14, 2026, three consecutive runs against local PostgreSQL on the
development workstation completed with 100 connected users and no failed
messages. Delivery P95 was 52.48 ms, 36.43 ms, and 63.16 ms.

Bursts of 10 concurrent writers were less stable on the same workstation and
could exceed 200 ms. Treat larger bursts as stress tests and repeat them in the
target hosting environment before raising the supported traffic profile.

## Scope

This is a single-host MVP baseline, not proof of internet-scale capacity. Before
horizontal scaling, move Socket.IO fan-out and message rate-limit state to a
shared Redis-backed adapter and run distributed load tests from separate hosts.
