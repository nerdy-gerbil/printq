# Deploying to Hostinger Business Web Hosting

Your plan is **Hostinger Business Web Hosting**, which runs Node.js apps through Hostinger's
managed Node runtime — a built-in deployment pipeline (GitHub sync or zip upload), automatic builds,
and a Restart button in the dashboard — **not** a VPS with Docker and root access. The [guide I
wrote first](docs/hostinger-deployment.md) is for Hostinger's VPS tier; this is the one that
matches the plan you actually have.

The app can run here, but two things are different from the VPS path:

- **No Postgres on the host.** Hostinger Business does not provide PostgreSQL — it is VPS-only on
  Hostinger, and MongoDB and Redis are VPS-only for the same reason. You must bring a managed
  Postgres from elsewhere (Supabase, Neon, Neon Vercel, or any external Postgres), and point the
  app's `DATABASE_URL` at it.
- **No Docker, no `docker compose`, no bind-mount of `/uploads`.** Hostinger's Node runtime builds
  and runs the app's standalone Next server for you, and the app's uploads live in the Hostinger
  file tree under your domain, backed up like any other directory through the File Manager.

Everything else — the Next.js standalone server, the healthcheck, the upload cap, the upload size
Hostinger's proxy must allow, the TLS and the Cloudflare Tunnel option — is the same.

## Before you start: the shape of this host

- The app is a **Next.js backend app**. Hostinger supports Next.js server-side apps specifically
  (framework detection, `hbuilds/current/nodejs` live build, Restart button in the dashboard), and
  the app's `runner` stage already produces a standalone Next server on port 3000.
- The app's files live under your domain's directory, something like
  `/home/{username}/domains/{domain}/`, with the live build at
  `hbuilds/current/nodejs` and the public-facing directory at `public_html`. You do not need to
  touch these paths by hand — Hostinger's deployment writes them — but you should know they exist
  when you back up uploads.
- Hostinger builds and restarts the app for you. You do **not** SSH in to start a process and leave
  it running; you deploy through the Node.js Web Apps dashboard, and restart from there if needed.
- A Business plan holds several Node.js apps (Hostinger says up to five, and you noted you still
  have room for more) — so this app is one slot in a shared Node runtime, not the whole server.
- TLS, the upload proxy size and the Cloudflare Tunnel option all apply exactly as they do on a VPS.

## What you need before you deploy

- A **managed Postgres** the app can reach over the internet, with a connection URL of the form

  ```
  postgresql://printq:password@host:5432/printq?schema=public
  ```

  Pick one with a connection string you can paste into an env variable. For a tiny office instance a
  free or low-cost managed Postgres is fine — the database is only a few megabytes and the app's
  queries are simple.
- Your **Hostinger domain** pointing at the hosted site, so the Node app serves on the real
  hostname.
- The two secrets:

  ```bash
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
  DB_PASSWORD="$(openssl rand -hex 24)"
  ```

  Plus the managed Postgres connection details (host, port, database, user, password) and the
  external Postgres host's allow-list, so Hostinger's outbound address can reach it.

## First: get Postgres out of the way

On the VPS path the app runs its own Postgres container. On Business, it does not — and cannot — so
the database is a separate piece you provision first.

1. **Create a managed Postgres** somewhere that gives you a connection URL and lets you add
   Hostinger's outbound IP to an allow-list (or allow-list `0.0.0.0/0` if you accept the trade).
   Note the full `DATABASE_URL`.
2. **Set `DATABASE_URL` as an environment variable** in the Hostinger Node.js app's environment panel
   — the same place you will put `BETTER_AUTH_SECRET` and the rest. Hostinger injects these into the
   build and runtime; the app reads `process.env` at request time, so nothing is inlined.
3. Leave `DB_PASSWORD` in your own records. The app reads the one connection string it needs from
   `DATABASE_URL`, so the old `DB_PASSWORD`-only setup is the VPS convenience, not a requirement
   here.

If the managed Postgres has its own first-run setup (create the database, user, etc.), do that before
the app tries to connect — the app expects `printq` to exist and to be writable by the `printq` user
in the connection string.

## Deploying the app to Hostinger Business

**Option 1 — GitHub deploy (recommended).** Hostinger's Node.js Web Apps flow deploys straight from a
GitHub repository with automatic builds:

1. In the Hostinger dashboard → **Websites** → **Create Website** → **Web App** → **Node.js web app**.
2. Choose **GitHub integration** and authorise Hostinger to read your repository.
3. Select the repository containing this project.
4. On the build settings screen, confirm the framework is detected as **Next.js (backend)**. If
   Hostinger detects it as a frontend app instead, switch it to a backend/server-side app type so the
   standalone server actually runs.
5. Set the environment variables the app needs:

   ```
   NODE_ENV=production
   BETTER_AUTH_SECRET=<the 32-byte secret>
   DATABASE_URL=postgresql://printq:…@managed-host:5432/printq?schema=public
   BETTER_AUTH_URL=https://print.example.org        # your real hostname
   PASSKEY_RP_ID=print.example.org                  # permanent; see below
   MODELS_ROOT=/home/.../domains/.../public_html/uploads   # or wherever Hostinger serves uploads
   MAX_REQUEST_BYTES=262144000                      # 250 MB in bytes
   TRUST_PROXY_HEADERS=<false|true|cloudflare>      # see the table below
   ```

   `MODELS_ROOT` points at a real writable directory inside your Hostinger domain tree. Use the
   path Hostinger's File Manager shows for the domain's `public_html` or a sibling `uploads` folder
   you create there; that directory is where uploaded models land and where the standalone server
   reads them from. It is backed up through the File Manager like any other directory.
6. **Deploy.** Hostinger builds, produces the standalone server under `hbuilds/current/nodejs`, and
   serves it. Use the **Restart** button in the app dashboard if a rebuild doesn't pick up a changed
   env variable.

**Option 2 — zip upload.** If you prefer not to connect GitHub:

1. Build the standalone output locally first (`npm run build` produces `.next/standalone` plus `.next/static` and `public`).
2. Zip the standalone output — the app's `runner` stage is what you are replicating: `.next/standalone` contents, `.next/static`, `public`, and the Prisma generated client under `node_modules/.prisma` and `node_modules/@prisma`.
3. Upload that zip through Hostinger's **Upload your website files** flow for a Node.js app.
4. Set the same environment variables and deploy.

In both cases Hostinger manages the long-lived server; you do not keep a terminal open.

## After deploy: claim the printer

Once the app is live and `DATABASE_URL` points at a real Postgres:

1. Open **`https://your-host.example/setup`** once in a browser.
2. Claim the printer — shop name, email, username, password. No admin variable, no bootstrap link.
3. From there, invite the office from `/admin/invites`.

If `/setup` says it is not available, an admin row already exists — check who can sign in at
`/admin/invites`, or reset through the guest list.

## TLS

The app refuses plain HTTP in production and passkeys need a secure context, so TLS is part of the
deployment here just as on a VPS. Hostinger's managed Node runtime is reached through Hostinger's own
routing, so make sure the hostname is served over HTTPS — the dashboard's SSL options or a reverse
proxy on the plan. Do not serve the app on plain `http://` in production.

## Upload size: Hostinger's proxy must allow it too

The app accepts models up to **250 MB**. Hostinger's proxy in front of the Node app has its own
opinion about request bodies. If a large upload fails at the proxy with a generic error and nothing
in the app log, the first place to look is the proxy's maximum request size — raise it on the plan
if you can, or tell the people uploading to keep models under whatever cap the plan enforces.

The same 300 MB allowance the VPS guide mentions applies in principle: a maximum-sized model arrives
as a slightly larger multipart body, so the working limit on the app side is a little above 250 MB,
but Hostinger's plan cap is whatever the plan sets, and `MAX_REQUEST_BYTES` cannot override a proxy
cap upstream of the app.

## Backup

Two things to back up, neither of them a Docker volume:

- **The database** — your managed Postgres. Back it up through the provider's own tooling. The app
  can also dump it on demand through the running app or the managed provider's interface, but the
  authoritative copy is the provider's.
- **The uploads** — the `uploads/` directory inside your Hostinger domain tree. Back it up through the
  File Manager, a download, or Hostinger's backup tooling. Losing it loses the current models; the
  database still has the rows, just without the files they point at.

Losing `BETTER_AUTH_SECRET` invalidates every session; losing the Postgres password (or its URL)
locks the database. Keep both somewhere off Hostinger.


## What to watch

- **Is the app running?** Dashboard → Node.js app → status, or the Restart button if it has stopped.
- **Did the build fail?** Dashboard → deployment log. A missing env variable or a wrong `DATABASE_URL`
  is the common first-deploy failure.
- **Is Postgres reachable?** If the app starts but nothing loads, the problem is usually the managed
  Postgres — wrong host, wrong password, Hostinger's outbound address not allow-listed.
- **Healthcheck.** The app exposes `/api/health`. Hit it from a browser or a monitor; the managed Node
  runtime exposes it the same way the standalone server does.

## Uploads, models and the directory they live in

On a VPS the app's uploads are a bind-mounted folder next to the database. On Business they are a
real directory in your Hostinger domain tree — the `uploads/` path you set in `MODELS_ROOT` — and
they are just files. The app writes them there, reads them back for downloads and the "open in a
slicer" helper, and records the storage key on each story.

That means:
- **A backup of that directory is a backup of the current models.** The database still has every
  story row; the files are the geometry.
- **Do not delete the directory by hand unless you mean to.** A stray `rm -rf` on the Hostinger file
  tree removes models the database still references.
- **If you ever migrate away from Business, copy this directory to the new host's `uploads/`.** The
  database dump + this directory is the whole state, same as the VPS backup.

## If you want the docker compose story instead

The whole stack — `docker-compose.prod.yml`, the Postgres container, the bind-mounted `DATA_ROOT`,
the migrator one-shot, the proxy or tunnel overlays — is written for a host that runs Docker and gives
you the postgreSQL and filesystem control to back it up like a machine. That is a **VPS**, or any host
that runs `docker compose` with a real Postgres you control.

On Hostinger that means the **VPS tier**, not Business Web Hosting. If you are on Business and want the
docker compose path, the move is:

1. Provision a Hostinger VPS (Ubuntu 24.04 with Docker, or any VPS where you can run the compose stack).
2. Follow the [plain VPS path](docs/deployment.md#deploying-to-a-plain-vps) there.
3. Migrate: dump the managed Postgres, restore it into the VPS Postgres container, copy the
   `uploads/` directory over, deploy the compose stack, and cut the hostname over.

That is the plan this project's deployment story is built around. Business can run the app; VPS can
run the stack.
