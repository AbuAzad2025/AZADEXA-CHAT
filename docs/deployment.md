# ZestChat Deployment

This guide covers the single-host Docker Compose deployment supplied with the
repository.

## Requirements

- Docker Engine with Docker Compose v2
- A Linux host with persistent disk storage
- A reverse proxy that terminates HTTPS before public traffic reaches the app
- DNS records for the web and API hosts

## Configure

Create the deployment environment file:

```powershell
Copy-Item .env.example .env
```

Replace every placeholder secret in `.env`. `DB_PASSWORD`, `JWT_SECRET`, and
`JWT_REFRESH_SECRET` are required and must not be committed. Set
`FRONTEND_URL` and `NEXT_PUBLIC_API_URL` to the public HTTPS origins before
building the images.

## Start

Build the images and start the stack:

```powershell
docker compose up -d --build
docker compose ps
```

The one-shot `migrate` service applies committed Prisma migrations before the
API starts. The web service waits for API readiness.

Verify the services:

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/ready
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

`/health` reports process liveness. `/ready` also verifies database access and
returns HTTP 503 while the API is not ready to receive traffic.

## Operate

Inspect status and recent logs:

```powershell
docker compose ps
docker compose logs --tail 200 api web migrate postgres
```

Restart application services without restarting PostgreSQL:

```powershell
docker compose restart api web
```

## Update

Pull the approved revision, rebuild, and let migrations complete before the new
API starts:

```powershell
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Always create a database backup before deploying migrations.

## Backup And Restore

The following commands use the default database name and user from
`.env.example`. Adjust them when the deployment uses different values.

Create a compressed backup inside PostgreSQL and copy it to the host:

```powershell
docker compose exec postgres pg_dump -U zestchat -d zestchat -Fc -f /tmp/zestchat.dump
docker compose cp postgres:/tmp/zestchat.dump ./zestchat.dump
docker compose exec postgres rm /tmp/zestchat.dump
```

Restore into an empty or intentionally replaceable database:

```powershell
docker compose cp ./zestchat.dump postgres:/tmp/zestchat.dump
docker compose exec postgres pg_restore -U zestchat -d zestchat --clean --if-exists /tmp/zestchat.dump
docker compose exec postgres rm /tmp/zestchat.dump
```

Test restoration regularly on a separate environment. A backup that has never
been restored is not yet a verified recovery path.

## Production Notes

- Do not expose PostgreSQL publicly. The supplied mapping binds it to
  `127.0.0.1`.
- Keep `.env`, database backups, and TLS private keys outside source control.
- Back up the `postgres_data` database and `api_uploads` media data.
- The current message rate limiter is process-local. Use a shared store before
  horizontally scaling the API beyond one process.
- Uploaded media uses a local Docker volume. Move it to object storage before
  running multiple API hosts.
- Add external uptime checks for the public web URL and API `/ready` endpoint.
