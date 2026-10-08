# PrintQ - Requests

[![CI](https://github.com/nerdy-gerbil/printq/actions/workflows/ci.yml/badge.svg)](https://github.com/nerdy-gerbil/printq/actions/workflows/ci.yml)
[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-docker%20compose-2496ed)](docs/deployment.md)
[![Stars](https://img.shields.io/github/stars/nerdy-gerbil/printq?style=flat)](https://github.com/nerdy-gerbil/printq/stargazers)
[![Forks](https://img.shields.io/github/forks/nerdy-gerbil/printq?style=flat)](https://github.com/nerdy-gerbil/printq/network/members)

**Invite-only 3D print requests for an office.** People upload a model, say
what they are hoping for, and follow it through the print stages on a board —
instead of asking in a corridor and then wondering. A small team works the
queue; an admin runs the shop.

Self-hosted, Docker Compose, no accounts anywhere but your own machine. One
printer and one office is the size it is built for, and it is honest about
that: there is no multi-tenancy, no billing, and no queue theory.

## What it looks like

| The rail — every request as a ticket, scoped to who may see it |
| :-- |
| ![The backlog board](docs/screenshots/board.png) |

| A ticket, with the actual uploaded geometry | The print team's queue |
| :-- | :-- |
| ![Story detail with the 3D viewer](docs/screenshots/story.png) | ![The queue](docs/screenshots/queue.png) |

## What it does

- **Invite-only.** There is no public sign-up. A `User` row cannot come into
  existence without a pending invitation, enforced in a single hook that every
  authentication method goes through.
- **Three roles, unlimited people.** `user` files and follows requests.
  `manager` works the queue — accept, print, hand over, flag, decline — beside
  the admin. `admin` additionally runs the shop: invites, members and their
  roles, materials, rates, the wishlist and the audit trail. There is no
  single-admin constraint; hand the second pair of keys out when you need to.
- **Claim it at `/setup`.** On a fresh database the first person to open
  `/setup` becomes the admin — name, email, username, password, all chosen
  there. No admin credentials in env files, no bootstrap link to chase. The
  page exists only until an admin does.
- **Upload a model** — `.stl` or `.3mf`, validated against its actual bytes
  rather than its filename, measured for its bounding box, stored as plain
  files on your volume and never in the web root.
- **Ask for colours** — one primary colour plus up to three extra ones for a
  multi-plate, multi-colour print. A ticket's stripe wears every spool it
  asked for, as bands.
- **Say where it came from** — an optional source link on a request (a
  Makeronline, Printables, MakerWorld, Thingiverse… page) shown as a badge on
  the ticket and the queue.
- **Follow it on a board** — Requested → Accepted → Printing → Delivery, one
  step at a time, forwards only. Or Declined, with a reason. Marking it **Done**
  takes it off the board while keeping it in *My orders*, so the rail carries
  only what is still moving.
- **Withdraw your own request** any time before it reaches the bed — while it
  is Requested, Accepted or Declined, but not once it is Printing. The ticket,
  the conversation and the uploaded file go with it. Plans change; unwanted
  prints waste filament.
- **Print an old request again** — re-queue any past ticket of yours as a
  fresh request, without hunting down and re-uploading the file. The model is
  copied server-side, and the colours, material and settings come with it.
- **Note print settings** — an optional free-text field for the slicer
  specifics that come with some files (layer height, infill, supports,
  temperatures). The team sees them on the ticket, so they do not become a
  back-and-forth.
- **Browse your history** — a dedicated `/history` view of the prints that
  have left the rail (delivered, done, declined), filterable by status,
  material and when, with **Print again** on every row.
- **Talk on the ticket** — a conversation thread per request, so "can you do
  it in teal" lives with the model rather than in a chat app.
- **Owner-managed benefits** — the "what's in it for you" tips are the admin's
  to define at `/admin/benefits`, and the ones marked *preferred* are starred
  on the upload form.
- **Owner-managed materials** — the catalogue of what a request can be made
  from lives on the Materials tab of `/admin/settings`, not in a compile-time
  list: add, rename, retire, restore. Retiring never rewrites a past ticket.
- **Owner-managed colours, per material** — the Colours tab of
  `/admin/settings` is where each material's swatches are defined, name and hex:
  a spool of PLA is not stocked in the shades a bottle of resin is. The upload
  form offers the chosen material's own list and swaps it the moment the
  material changes, and a ticket keeps the swatch it was asked for, so
  recolouring a spool never rewrites history.
- **A cost ledger, derived not stored** — the team records what a finished
  print *weighed* (grams) and *ran* (minutes) on the ticket; the app derives
  the cost at render from the current rates: $/kg per material, one $/hour for
  the machine, set on the Materials and Rates tabs of `/admin/settings`.
  Nothing is
  snapshotted, nothing is inferred, and nothing is shown to the requester —
  what a print costs the team is the team's ledger.
- **A wishlist** — the intake queue for "ooh, print this": paste a product
  link at `/admin/wishlist` and the page's own title and picture are picked up
  and cached, with a source badge. Nothing there is a promise; the board is
  the commitment.
- **Revoke access when someone leaves** — suspends the account, signs them out
  everywhere and refuses new sign-ins, while keeping their tickets, comments
  and history. Reversible, and audited.
- **See the actual geometry** — the uploaded mesh rendered in the browser,
  auto-framed, drag to rotate.
- **An audit trail** of everything that changes who can get in or what happens
  to someone's model, readable at `/admin/audit`, never edited or deleted.
- **Ask for features, triaged like the backlog** — a parallel "frr" board at
  `/frr` where anyone files a feature request and the team moves it through
  the same stages, conversation, notifications and audit trail a print goes
  through. See **[Feature requests](docs/feature-requests.md)**.
- **Drive it over HTTP** — every ticket, transition, comment and notification
  is a JSON endpoint, described by an OpenAPI 3.1 document and callable from a
  Swagger console at `/docs`. Same session, same scope, same audit trail as
  the UI. See **[the API](docs/api.md)**.
- **Shout it to chat** — set `WEBHOOK_URL` and every notification the print
  team receives is also POSTed as `{ "content": …, "text": … }` to a
  Discord or Slack webhook (each reads its own field and ignores the
  other). Fire-and-forget; a down relay never blocks the queue.
- **Open a model straight in a slicer** — one click on a ticket hands the
  model to **PrusaSlicer** or **Anycubic Slicer Next (FDM)** running on your
  own machine. A small helper the admin installs once does the fetch, because
  the slicers' own deep links refuse arbitrary hosts. The link carries its own
  short-lived credential, so nothing secret sits in the helper's config.
  See **[Open in a slicer](docs/prusaslicer.md)**.
- **Or just take the file** — a plain download on every ticket, for a machine
  without the helper, a phone, or a slicer that is neither. Same permissions
  as the ticket, and recorded when the bytes go to somebody other than the
  person who uploaded them.

## Requirements

| | |
| --- | --- |
| Host | anything that runs Docker Compose on **`linux/amd64`** — a NAS, an x86 VPS, a spare laptop. **Not arm64.** The published `printq-app` and `printq-migrate` images are built for amd64 only, and a second architecture would have to be verified rather than merely built — the suites are this project's contract, and running them twice is not a commitment it makes. An arm64 host (a Pi 5, an Ampere VPS, an Apple Silicon Mac) fails at `docker compose pull` with `no matching manifest for linux/arm64`. |
| Memory | ~1 GB for the whole stack (app, database) |
| Disk | small — the database is megabytes; uploads are capped at 250 MB each |
| TLS | **required.** The app refuses to start on plain `http://` in production, and passkeys need a secure context |
| Mail | **optional.** Nothing needs it — see [Mail is optional](docs/authentication.md#mail-is-optional--genuinely) |

## Quick start

```bash
git clone https://github.com/nerdy-gerbil/printq.git && cd printq
cp .env.docker.example .env.docker
```

Edit `.env.docker` — generate the two secrets:

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
DB_PASSWORD="$(openssl rand -hex 24)"
```

There is nothing to set for the admin. The first one is created through the
**first-run `/setup` page**, in the browser, after the stack is up.

**Leave `APP_URL` and `PASSKEY_RP_ID` at the example's localhost values for
now.** They are what Better Auth derives cookie scope and the WebAuthn relying
party from, so setting them to a public hostname and then running on
`http://localhost:3000` gives you a stack you cannot sign into: the browser
sends an origin the app does not trust, and receives a `__Secure-` cookie it
discards over plain HTTP. Set them when you deploy — see
**[docs/deployment.md](docs/deployment.md)**.

Then bring it up. This build-from-source variant publishes ports and catches
mail locally, which is what you want for a first look:

```bash
docker compose --env-file .env.docker \
  -f docker-compose.prod.yml -f docker-compose.build.yml \
  -f docker-compose.test.yml --profile mailcatcher up -d --build
```

Open **http://localhost:3000/setup** once and claim the printer: the shop's
name, an email, a username and a password. The page only exists while there is
no admin, so this is a first-run ritual, not a door you leave open. Then
invite the office from `/admin/invites`. For a real deployment behind a
reverse proxy, see **[docs/deployment.md](docs/deployment.md)**.

> There is deliberately no `ADMIN_PASSWORD` and no bootstrap link. A password
> in an env file is also in `docker inspect`, in the shell history that wrote
> it, and in every backup of the host. A page that exists only until it is
> used, over a session that is yours alone, is a smaller thing to leak.

## Configuration

Everything is environment variables, read from `.env.docker`. The full file
with commentary is [`.env.docker.example`](.env.docker.example).

| Variable | Required | What it does |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | **yes** | Signs session cookies and slicer-link credentials. `openssl rand -base64 32`. Losing it invalidates every session. |
| `DB_PASSWORD` | **yes** | Database password. For the MySQL on Hostinger Business path, the MySQL user password; for the VPS/compose path, the Postgres password that the compose stack bakes into its data directory on first start — see [Restore](#restore). |
| `APP_URL` | **yes** | The origin the browser sees, including scheme. Cookies, invitation links and the WebAuthn relying party derive from it. Must be `https://` in production. |
| `PASSKEY_RP_ID` | **yes** | Registrable domain, no scheme or port. **Permanent** — changing it kills every enrolled passkey. |
| `PASSKEY_RP_NAME` | | Shown in the browser's passkey prompt. |
| `DATA_ROOT` | | Where the database and uploads live on disk. Default `./data`. |
| `SMTP_URL` | | SMTP transport. **Leave unset and the app still works** — links are shown to the admin to hand over. |
| `RESEND_API_KEY` | | Alternative to `SMTP_URL`; takes precedence. |
| `MAIL_FROM` | | Envelope sender. |
| `WEBHOOK_URL` | | POST every print-team notification as `{ "content": …, "text": … }` — a Discord or Slack webhook URL; each platform reads its own field. Fire-and-forget. |
| `TRUST_PROXY_HEADERS` | | Which header carries the client address: `false` (trust nothing, the default), `true` (left-most `X-Forwarded-For`), or `cloudflare` (`CF-Connecting-IP`). See [the reasoning](docs/deployment.md#why-trust_proxy_headers-is-a-separate-switch). |
| `HIBP_DISABLED` | | `true` disables the breach check. Only for a host with no outbound internet — it fails closed, so without it nobody could register. |
| `SOURCE_URL` | | Where this instance's source lives, shown in the footer. **Change it if you modify the code** — see [Licence](#licence). Defaults to the upstream repository. |
| `PRINTQ_REGISTRY` / `PRINTQ_TAG` | | Which published image to run. Pin `PRINTQ_TAG` to a release (`v0.1.0`) or a commit SHA; either is also how you roll back. |
| `CF_TUNNEL_TOKEN` | | Connector token for `docker-compose.tunnel.yml`, from Cloudflare Zero Trust. A credential: anything holding it can serve the hostnames routed to that tunnel. See [Deploying behind a Cloudflare Tunnel](docs/deployment.md#deploying-behind-a-cloudflare-tunnel). |

## Deploying

The short version: pull a published image, put a reverse proxy in front, point
`DATA_ROOT` at real storage.

```bash
docker compose --env-file .env.docker \
  -f docker-compose.prod.yml -f docker-compose.proxy.yml up -d
```

On a connection whose public address is not yours to keep — a dynamic one, or
none at all — `docker-compose.tunnel.yml` replaces the reverse proxy with a
Cloudflare Tunnel connector that dials *outward*, so there is no port to
forward and no `A` record to keep current. See
[Deploying behind a Cloudflare Tunnel](docs/deployment.md#deploying-behind-a-cloudflare-tunnel).
For PaaS-style hosts that build from a repository, `docker-compose.dokploy.yml`
is a template that builds the images, migrates, then starts the app.

`docker-compose.prod.yml` **consumes** images rather than building them, so a
deployment needs no source tree and no toolchain, and what runs there is
byte-for-byte what CI tested and signed. It publishes **no host ports at all** —
each overlay adds only what its context needs.

Every merge to `main` publishes images tagged with the commit SHA and `latest`;
every `v*` tag publishes that same commit under its version. Pin `PRINTQ_TAG`
to a release if you want to move deliberately, or to a SHA if you want to
follow `main` closely.

The images are named `printq-app` and `printq-migrate`, and published from
`ghcr.io/nerdy-gerbil`. They are **public**, so a deployment needs no registry
credential at all. `scripts/deploy-wizard.sh` reflects that: run it without a
token and it lists releases, which is the right menu for most deployments;
give it a `read:packages` token and it lists every published image including
SHA builds. That token is optional, is never stored, and is only needed
because GitHub gates the package *listing* API even for public packages.

`scripts/deploy-wizard.sh` is the way to move between versions: it lists what
is published, cosign-verifies before swapping, health-checks after, and rolls
back on its own if the new image does not come good. See
**[docs/deployment.md](docs/deployment.md)**.

## Backup and restore

### Back up

Everything that matters is under `DATA_ROOT` plus one file:

| | |
| --- | --- |
| `$DATA_ROOT/db/` | **VPS/compose path only:** the Postgres data directory. On Hostinger Business the database is the MySQL database Hostinger gives you — not a folder on disk — so there is nothing under `DATA_ROOT/db/` to back up there. |
| `$DATA_ROOT/uploads/` | the uploaded `.stl` / `.3mf` files **and** the cached wishlist thumbnails, as plain files — on every path |
| `$DATA_ROOT/models/` | **only if you have not migrated yet** — the old object store's data directory. Plain `tar` cannot read it usefully; see [Deployment](docs/deployment.md). |
| `.env.docker` | the secrets. **Not** under `DATA_ROOT`, and not in the repo. |

On ZFS, one recursive snapshot of the parent dataset captures all three:

```bash
zfs snapshot -r storage/applications/printq@$(date +%F)
```

That snapshot is *crash-consistent*, not clean — Postgres replays its WAL on
start and recovers, which is fine and is what it is designed for.

**Without ZFS, do the file copy from inside a container.** The Postgres data
directory is mode `700` owned by uid `70`, so a `tar` or `cp -a` as your own
user cannot even read it, and one run with `sudo` that loses ownership produces
an archive Postgres will refuse to start from:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml down
docker run --rm -v "$DATA_ROOT:/data:ro" -v "$PWD:/backup" alpine \
  tar czf /backup/printq-$(date +%F).tgz -C /data .
```

Either way, take a logical dump alongside it — it restores into *any* Postgres,
not only back onto this data directory, and it needs no root:

```bash
docker exec printq-db pg_dump -U printq -Fc printq > printq-$(date +%F).dump
```

### Restore

```bash
# 1. stop the stack — never restore under a running Postgres
docker compose --env-file .env.docker -f docker-compose.prod.yml down

# 2. put the data back (ZFS rollback, or extract the archive)
zfs rollback storage/applications/printq/data/db@2026-08-23
zfs rollback storage/applications/printq/data/uploads@2026-08-23
#   without ZFS, from the container-made archive:
#   docker run --rm -v "$DATA_ROOT:/data" -v "$PWD:/backup:ro" alpine \
#     sh -c 'rm -rf /data/db /data/uploads && tar xzf /backup/printq-2026-08-23.tgz -C /data'

# 3. bring it up; the migrator applies any pending migrations
docker compose --env-file .env.docker -f docker-compose.prod.yml up -d
docker compose --env-file .env.docker -f docker-compose.prod.yml ps
```

Restoring from a logical dump instead, onto a running stack:

```bash
docker exec -i printq-db pg_restore -U printq -d printq --clean --if-exists < printq-2026-08-23.dump
```

### When it goes wrong

Both of these were confirmed by actually doing it, not by reasoning about it.

**`DB_PASSWORD` must be the one the restored data was created with.** Postgres
stores the password inside the data directory and ignores `POSTGRES_PASSWORD`
once that directory exists. Get it wrong and the symptoms point everywhere
except the cause:

| what you see | |
| --- | --- |
| `printq-db` | **healthy** — this is the misleading part |
| `printq-app` | never starts, so it logs nothing at all |
| `printq-migrate` | `Error: P1000: Authentication failed against database server` |

So look in the **migrator's** logs, which is the one place nobody thinks to
check because it is the container that is supposed to exit:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml logs migrate
```

Nothing is damaged by getting this wrong — the wrong password is refused, not
destructive. Put the right one back and everything returns. This is the main
reason `.env.docker` belongs in the backup.

**`BETTER_AUTH_SECRET` is not recoverable, and costs one sign-in.** Restore
without it and every existing session cookie stops validating — a held cookie
goes from `200` to a `307` back to the sign-in page. Nobody is locked out:
passwords and passkeys are untouched, and everyone simply signs in again.

## Troubleshooting

**502 from the reverse proxy, nothing in the app's logs.**
The proxy cannot reach the container. If you route by container name over a
shared Docker network, check both are still on it — updating a proxy that is
itself a managed app recreates its container and silently drops the
attachment:

```bash
docker network inspect npm-proxy --format '{{range .Containers}}{{.Name}} {{end}}'
docker run --rm --network npm-proxy curlimages/curl -sS -m 5 http://printq-app:3000/api/health
```

**`unauthorized` when pulling the images.**
The published images are public, so this should not happen — check the tag
exists before assuming it is an auth problem:

```bash
docker manifest inspect ghcr.io/nerdy-gerbil/printq-app:v0.1.0
```

On a **fork** with private packages you do need a credential, and it must be a
*classic* token with **`read:packages`** and nothing else — that scope is
nested under `write:packages` in the checkbox list, which is easy to scroll
past. Fine-grained tokens do not work with ghcr.io at all. Check what yours
carries:

```bash
curl -sSI -H "Authorization: Bearer $TOKEN" https://api.github.com/user | grep -i x-oauth-scopes
```

**The certificate will not issue.**
ACME HTTP-01 validation goes to whatever the public DNS record points at. If
that is still your web host rather than your proxy, the challenge is answered
by the wrong machine and nothing you change locally will help. Check where the
name actually resolves, and what answers there:

```bash
dig +short your.host.example
curl -sS -D - "http://your.host.example/.well-known/acme-challenge/probe" | head -5
```

Behind Cloudflare's proxy, visitors see Cloudflare's certificate regardless, so
an **Origin Certificate** plus SSL mode *Full (strict)* removes ACME from the
picture entirely.

**Every page loads and nothing works — sign-in included.**
Cloudflare's **Rocket Loader** rewrites every `<script>` to load through its own
deferred loader, and the rewritten tags do not carry the per-request CSP nonce
this app's `script-src` requires. Hydration never happens, so no client-side code
runs: the pages render from server HTML and look perfectly normal, but the
sign-in form, the upload progress bar, the 3D viewer and the Activity menu all do
nothing. The console shows CSP violations; the app's own logs show nothing at
all, because the requests never reach it. Turn Rocket Loader off, globally or
with a Configuration Rule scoped to the hostname — see
[deployment](docs/deployment.md). Auto Minify and Brotli are fine.

**Audit rows have no IP address.**
`TRUST_PROXY_HEADERS` is unset or `false`, so nothing is trusted. Behind
Cloudflare set it to `cloudflare` — not `true`, because Cloudflare *appends* to
`X-Forwarded-For` and the left-most entry there is whatever the client sent.
Behind a proxy that replaces the header, `true`. Set either only if the app
cannot be reached without going through that proxy.

**`/setup` is gone, and the printer was never claimed.**
The page only exists while the database has no admin. If it answers 404 or says
it is not available, an admin row already exists — check who can sign in at
`/admin/invites`, or take a peek in the database. There is deliberately no
second bootstrap: a page that can mint admins is a page worth finding, so it
stops existing the moment it has work to protect.

**Nobody can register, and the error mentions a breach check.**
The password check calls `api.pwnedpasswords.com` and fails closed. If the host
has no outbound internet, set `HIBP_DISABLED=true` — and only then.

## Documentation

| | |
| --- | --- |
| **[Authentication](docs/authentication.md)** | the three roles, invite-only registration, passwords, passkeys, resets, and why each decision went the way it did |
| **[Architecture](docs/architecture.md)** | the viewer, upload validation, decisions taken against the design handoff, and the file layout |
| **[Deployment](docs/deployment.md)** | containers, reverse proxies, the deploy wizard, TLS, first run, PaaS templates |
| **[Feature requests](docs/feature-requests.md)** | the `/frr` track — file a request, triage it exactly like the print backlog |
| **[The API](docs/api.md)** | the JSON surface, bearer tokens, the OpenAPI document and the console at `/docs` |
| **[Open in a slicer](docs/prusaslicer.md)** | the `printq://` and `printq-anycubic://` bridges, the helper, and why the deep links cannot be used |
| **[Development](docs/development.md)** | stack, local setup, the verification suites, CI |
| **[Security audit](docs/security-audit.md)** | the OWASP Top 10 assessment, findings, and residual risk accepted |
| **[Security policy](SECURITY.md)** | how to report a vulnerability |
| **[Contributing](CONTRIBUTING.md)** | the ten suites are the contract; what a good change looks like |
| **[Changelog](CHANGELOG.md)** | what changed in each release |

## Security

Invite-only enforced in one hook across every authentication method. Passwords
are ≥10 characters and refused if they appear in a known breach corpus.
Authorisation answers **404, not 403**, for a resource you may not see — a 403
confirms it exists. CSP carries a per-request nonce. Every access and content
change is audited.

Session cookies are `HttpOnly`, `SameSite=Lax` and `__Secure-` prefixed, with
cookie caching deliberately off so sign-out is immediate. A session is worth
**twenty idle minutes**, not a month: the window used to renew itself on every
visit, which meant a captured cookie on a shared desk was good more or less
indefinitely. Twenty minutes is only humane because passkeys are here, and
signing back in is a touch.

Shortening it limits how long a stolen cookie is useful but not whether it is
useful *now*, so the four actions that outlive a session — inviting somebody,
re-sending an invitation, minting a password-reset link, revoking or restoring
access — ask for the passkey or the password again if the current sign-in is
more than five minutes old. That is the one control on the list a copied cookie
cannot satisfy.

The full assessment, including what was found and fixed and what is knowingly
accepted, is in [docs/security-audit.md](docs/security-audit.md). To report
something, see [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. The ten verification suites in
`scripts/` are the contract — `verify:models`, `verify:auth`, `verify:upload`,
`verify:queue`, `verify:frr`, `verify:benefits`, `verify:wishlist`, `verify:api`,
`verify:passkey` and `probe:security`. All but `verify:models` run in CI against
the built container image rather than a dev server. If a change makes one fail,
that is the change talking.

See [docs/development.md](docs/development.md) to get set up.

## Licence

[AGPL-3.0-or-later](LICENSE). Self-host it, fork it, change it, run it for your
office — all of that is yes, and free.

The app carries a **Source · AGPL-3.0** link in its footer. That is section 13
made real: if you modify the code, point `SOURCE_URL` at your own repository.
Leaving it aimed at upstream is worse than removing it, because it looks like
compliance while offering source that is not what is running.

The one condition is the point of the licence: **if you modify it and let people
use your version over a network, you have to offer them your source.** Not a
courtesy, a term. It covers the case a plain GPL misses — running a modified
version as a service without ever distributing a copy — which is exactly how
web software gets taken private.

What that does and does not mean:

- **Running it unmodified obliges you to nothing.** Deploy it for your office,
  never touch the code, and there is nothing to publish and nobody to tell.
- **Modify it and let others use it, and those users can ask for your source.**
  Note *others* includes your own colleagues — §13 counts anyone interacting
  over a network, not just paying customers. In practice that is easy: point
  them at your fork.
- **Selling it is allowed.** No open source licence forbids commercial use, and
  this one does not either. Sell support, sell hosting, sell it outright — your
  users just get the source too.
- **Modification nobody else touches is unconstrained.** Hack on it locally, on
  your own, forever, and the clause never bites.

The asymmetry is deliberate: the licence asks for reciprocity from those who
benefit publicly, and nothing from those who merely use it.

If your organisation's policy forbids AGPL software — some do, blanket-style —
you are welcome to ask about other terms.

Story refs read `PrintQ-104` — a hundred-series, like a diner's ticket rail,
which is the look the board is going for.
