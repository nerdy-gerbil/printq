# Deploying to Hostinger Business Web Hosting

Your plan is **Hostinger Business Web Hosting**, which runs Node.js apps through Hostinger's
managed Node runtime — a built-in deployment pipeline (GitHub sync or zip upload), automatic builds,
and a Restart button in the dashboard — **not** a VPS with Docker and root access. The
[plain-VPS path](deployment.md#deploying-to-a-plain-vps) is for Hostinger's VPS tier instead; this is
the one that matches the plan you actually have.

The app can run here. The one thing that is different from the VPS path is the database: Hostinger
Business gives you **MySQL with phpMyAdmin**, and the app now runs on MySQL — the schema is pinned to
the `mysql` provider in `prisma/schema.prisma`, the client is regenerated from it, and the Better Auth
adapter is told `provider: "mysql"`. (The compose/VPS path, CI and the dev stack still run their own
Postgres container; that is a separate, still-valid way to run the app. This guide is the MySQL path.)

The other difference from the VPS path is operational, not a database one: no Docker, no `docker
compose`, no bind-mount of `/uploads`. Hostinger's Node runtime builds and runs the app's standalone
Next server for you, and the app's uploads live in the Hostinger file tree under your domain, backed up
like any other directory through the File Manager.

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
  when you back up uploads. The database is **not** a file in that tree: it is the MySQL database
  Hostinger gives you, reached over the connection string, not a folder you back up through the File
  Manager.
- Hostinger builds and restarts the app for you. You do **not** SSH in to start a process and leave
  it running; you deploy through the Node.js Web Apps dashboard, and restart from there if needed.
- A Business plan holds several Node.js apps (Hostinger says up to five, and you noted you still
  have room for more) — so this app is one slot in a shared Node runtime, not the whole server.
- TLS, the upload proxy size and the Cloudflare Tunnel option all apply exactly as they do on a VPS.

## What you need before you deploy

- **MySQL from Hostinger.** Business Web Hosting includes a free MySQL database with phpMyAdmin.
  Create one in the Hostinger dashboard, note the connection details (host, port, database name, user,
  password).
- Your **Hostinger domain** pointing at the hosted site, so the Node app serves on the real
  hostname.
- The four MySQL connection variables. The Hostinger dashboard names the database
  `{account}_{name}`, not plain `printq`, and Hostinger will not let you rename it. The app no longer
  requires you to build a `DATABASE_URL` by hand for this path: it reads the four parts and assembles
  `mysql://DB_USER:DB_PASSWORD@DB_HOST:3306/DB_NAME` itself, before PrismaClient is constructed —
  percent-encoding the credentials as it goes, so a `#`, `/`, `?` or space in `DB_PASSWORD` cannot
  break the URL, and taking the port from `DB_HOST` when the host was pasted in with one. A URL that
  would not parse fails at boot with an error naming the variable, rather than Prisma's `invalid port
  number`. The compose/docker path still uses `DATABASE_URL` directly — those variables are only for
  the Hostinger Business MySQL path.

  ```bash
  DB_HOST=                  # the MySQL host Hostinger gave you, e.g. mysqlXX.hostinger.com
  DB_NAME=                  # the database name as Hostinger named it, e.g. u678003261_printq
  DB_USER=                  # the MySQL user, e.g. u678003261_printq
  DB_PASSWORD="$(openssl rand -hex 24)"   # the MySQL user's password
  ```

  `DB_PASSWORD` is the MySQL user's password. The other three are the Hostinger database details.
  None of them is a secret the app would ever print; `DB_PASSWORD` is the only one worth keeping out
  of logs and screenshots, same as anywhere else. The app reads `process.env` at request time, so
  nothing is inlined.

## First: create the MySQL database on Hostinger

On the VPS path the app runs its own Postgres container. On Business, it runs MySQL from the database
Hostinger gives you.

1. In the Hostinger dashboard, create a **MySQL database** for this app. Note the host, port (usually
   3306), database name, username and password.
2. **Set the four MySQL connection variables** in the Hostinger Node.js app's environment panel —
   the same place you will put `BETTER_AUTH_SECRET` and the rest. Hostinger injects these into the build
   and runtime; the app reads `process.env` at request time, so nothing is inlined.
   ```
   DB_HOST=...     # the MySQL host Hostinger gave you
   DB_NAME=...     # the database name as Hostinger named it, e.g. u678003261_printq
   DB_USER=...     # the MySQL user, e.g. u678003261_printq
   DB_PASSWORD=... # the MySQL user's password
   ```
3. Do **not** set `DATABASE_URL` on the Hostinger panel for this path. The app assembles it from the
   four variables above. (The compose/docker path still uses `DATABASE_URL` directly — that variable is
   only for the container stack, not for Hostinger Business MySQL.)

The app expects a database writable by the user in `DB_USER`, on the host in `DB_HOST`, named exactly
as `DB_NAME` says. Hostinger will have named it `{account}_{name}`, which is why the app no longer
assumes the name is `printq`. Create the database with the name Hostinger gives you, set `DB_NAME` to
that name, and the app's first migration (the one that creates the tables) will find what it expects.
phpMyAdmin is how you confirm the database exists and look at what the app wrote; the app is how you
write to it.

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
   NPM_CONFIG_INCLUDE=dev                                      # npm, not the app: install devDependencies too
   BETTER_AUTH_SECRET=<the 32-byte secret>
   DB_HOST=mysqlXX.hostinger.com                                # the MySQL host Hostinger gave you
   DB_NAME=u678003261_printq                                   # the database name as Hostinger named it
   DB_USER=u678003261_printq                                  # the MySQL user
   DB_PASSWORD=<the MySQL user's password>
   BETTER_AUTH_URL=https://print.example.org                   # your real hostname
   PASSKEY_RP_ID=print.example.org                             # permanent; see below
   MODELS_ROOT=/home/.../domains/.../public_html/uploads        # or wherever Hostinger serves uploads
   MAX_REQUEST_BYTES=262144000                                 # 250 MB in bytes
   TRUST_PROXY_HEADERS=<false|true|cloudflare>                 # see the table below
   ```

   Do **not** set `DATABASE_URL` on the Hostinger panel for this path. The app reads `DB_HOST`,
   `DB_NAME`, `DB_USER` and `DB_PASSWORD` and assembles the MySQL connection URL itself, before
   PrismaClient is constructed. The compose/docker path still uses `DATABASE_URL` directly — that
   variable is only for the container stack. The schema is already pinned to the `mysql` provider, the
   client is already regenerated from it, and the Better Auth adapter is already told
   `provider: "mysql"` — that conversion is done in this repo (`prisma/schema.prisma`,
   `prisma/migrations/migration_lock.toml`, `src/lib/auth.ts`). You do not convert anything; you just
   give the app the Hostinger database details it assembles the URL from.

   `MODELS_ROOT` points at a real writable directory inside your Hostinger domain tree. Use the
   path Hostinger's File Manager shows for the domain's `public_html` or a sibling `uploads` folder
   you create there; that directory is where uploaded models land and where the standalone server
   reads them from. It is backed up through the File Manager like any other directory.

   `NPM_CONFIG_INCLUDE=dev` is not read by the app at all — it is an instruction to npm, and the
   build does not work without it. The section after the deploy steps is the whole story.

6. **Deploy.** Hostinger builds, produces the standalone server under `hbuilds/current/nodejs`, and
   serves it. Use the **Restart** button in the app dashboard if a rebuild doesn't pick up a changed
   env variable.

**Option 2 — zip upload.** If you prefer not to connect GitHub:

1. Build the standalone output locally first (`npm run build` produces `.next/standalone` plus `.next/static` and `public`).
2. Zip the standalone output — the app's `runner` stage is what you are replicating: `.next/standalone` contents, `.next/static`, `public`, and the Prisma generated client under `node_modules/.prisma` and `node_modules/@prisma`.
3. Upload that zip through Hostinger's **Upload your website files** flow for a Node.js app.
4. Set the same environment variables and deploy.

In both cases Hostinger manages the long-lived server; you do not keep a terminal open.

## `NODE_ENV=production` hides the build's own dependencies

This is the one failure on this host that looks like a bug in this repository, so it gets its own
section.

`npm install` skips `devDependencies` whenever `NODE_ENV=production` is set — npm's `production`
config defaults to it, and the app's whole environment is in place while Hostinger builds. The
install step therefore installs roughly half the tree, and the build then dies on the first tool
that is missing, naming the tool and nothing else:

```
==> Installing dependencies
Running "npm install"
added 115 packages, and audited 116 packages in 14s

==> Building
Running "npm run build"

> printq@0.1.0 prebuild
> npm run vendor:swagger

sh: line 1: tsx: command not found
ERROR: Failed to build the application
```

`tsx` is a devDependency, and so are the Prisma CLI, TypeScript, Tailwind and the `@types`
packages — every one of them needed to **build** the app, none of them needed to **run** it. The
compose path never meets this, because the Dockerfile's builder stage runs a full `npm ci`; that is
also why nothing in this repository had to care about it until this host.

`NPM_CONFIG_INCLUDE=dev` is the fix. It is npm's own `include` config, set in the environment npm
reads it from, and it outweighs the `production` default without touching it — `NODE_ENV=production`
still has to stay, because the app wants it. You can see it worked in the next build log: the
install line reads **about 195 packages** instead of 115.

If it does not take effect — a host is free to pass `npm install` flags of its own, and flags beat
environment variables — put the install in the build command instead and leave the rest of the
command alone:

```
npm install --include=dev && npm run build
```

Either way the build is the same build CI runs; what changes is only which half of the dependency
tree is present while it runs. `scripts/check-build-deps.mjs` also runs first in `prebuild` now, so
a tree that is missing any of these is told what is missing and which command installs it, rather
than `tsx: command not found`.

## The database needs its tables, and nothing here applies them for you

The compose path has a **migrator** one-shot that runs `prisma migrate deploy` and the seed before
the app may start, so a deployment can never serve against an unmigrated schema. Hostinger runs the
app and nothing else, so the schema is a one-time step you run yourself, from a checkout of this
repository, against the Hostinger database. Check out the same commit you deployed — the
migrations on disk have to match the code about to run against them — with `npm install` done
(`prisma` and `tsx` are ordinary dependencies, so even a production-only install has them):

```bash
export DB_HOST=mysqlXX.hostinger.com
export DB_NAME=u678003261_printq
export DB_USER=u678003261_printq
export DB_PASSWORD='<the MySQL user password>'    # single quotes keep # ! $ literal
export DATABASE_URL="$(npx tsx scripts/db-url.ts)"
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

That `db-url.ts` line is not decoration: the Prisma CLI and the seed read **only** `DATABASE_URL`
— the four variables are the app's own path and never reach either command, which fails with
`Environment variable not found: DATABASE_URL` on its own. The script assembles the URL through the
same code the app uses (credentials percent-encoded, the port taken from `DB_HOST` when it carries
one) and fails naming the variable when a part is missing or a host will not parse. You can also
assemble `DATABASE_URL` yourself and export just that — the app uses whichever is set.

Expect `14 migrations found` on the first run (the count as of this writing), each migration
listed as it applies, and none pending after. The seed prints four lines: `Benefits ready: 5
default tip(s) present.`, `Materials ready: 4 default material(s) present.`, `Colours ready: 5
swatch(es) per material, editable at /admin/settings.`, `Cost calculator rates ready (edit them at
/admin/settings).`, and `No administrator is seeded — open /setup once to claim the printer.` A
fresh clone that has never built may be told to run `npx prisma generate` before the seed; do.

Those are the same two commands the migrator's `CMD` runs, in the same order. `migrate deploy`
applies the migrations in `prisma/migrations/` and records them in `_prisma_migrations`, so a second
run is a no-op — which is why it is the subcommand to reach for and `migrate dev` is not. The seed
is idempotent and non-destructive: it adds the default benefits, materials, each material's five
starting colours and the cost rates, and never overwrites a row the owner has already edited.

The catch is reaching the database from outside Hostinger. Business MySQL is normally closed to the
internet until you allow your own IP in the database section of the dashboard; a connection that
**times out** rather than being refused is that allowlist, not the password. The opposite
shape is `Authentication failed against database server`: the connection reached the database
and the user or password was wrong — fix the value itself.

Until the tables exist, every page answers with Prisma's P2021 — *the table does not exist in the
current database* — and `/setup` is not excepted.

## After deploy: claim the printer

Once the app is live and the four MySQL connection variables point at the Hostinger MySQL database:

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

Two things to back up, and they are not the same kind of thing:

- **The database** — the MySQL database Hostinger gave you. Back it up through Hostinger's own tooling
  (the database section of the dashboard, a dump through phpMyAdmin, or Hostinger's backup service).
  The authoritative copy is Hostinger's, not a file in your domain tree.
- **The uploads** — the `uploads/` directory inside your Hostinger domain tree. Back it up through the
  File Manager, a download, or Hostinger's backup tooling. Losing it loses the current models; the
  database still has the rows, just without the files they point at.

Losing `BETTER_AUTH_SECRET` invalidates every session; losing the MySQL password (or its URL) locks
the database. Keep both somewhere off Hostinger.


## What to watch

- **Is the app running?** Dashboard → Node.js app → status, or the Restart button if it has stopped.
- **Did the build fail?** Dashboard → deployment log. A missing env variable or a wrong `DATABASE_URL` (or the four MySQL variables) is the common first-deploy failure.
- **Is MySQL reachable?** If the app starts but nothing loads, the problem is usually the Hostinger
  MySQL database — wrong host, wrong password, wrong database name in `DB_NAME`/`DB_HOST`/`DB_USER`/`DB_PASSWORD`,
  or the app cannot reach the database host from where Hostinger runs it.
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
2. Follow the [plain VPS path](deployment.md#deploying-to-a-plain-vps) there.
3. Migrate: dump the managed Postgres, restore it into the VPS Postgres container, copy the
   `uploads/` directory over, deploy the compose stack, and cut the hostname over.

That is the plan this project's deployment story is built around. Business can run the app; VPS can
run the stack.
