# Deploying to Hostinger

Hostinger's VPS plans ship **Ubuntu 24.04 64-bit with Docker pre-installed** in a
`docker` template — a free or managed Docker-ready flavour — so there is no manual Docker install,
no `apt` fiddling and no systemd service written by hand. From the host's point of view this is a
plain amd64 VPS: clone, set secrets, pull the images, claim the printer, put TLS in front.

Everything here is a special case of the [plain VPS path](docs/deployment.md#deploying-to-a-plain-vps),
so the certificate, firewall and storage notes there apply in full; only the host setup and the
first commands are different.

## What Hostinger gives you

- Ubuntu **24.04** 64-bit, the `docker` template includes Docker Engine and the Compose plugin.
- No outbound mail by default: a Hostinger VPS has no outgoing mail relay, so `SMTP_URL` points at
  your own server, Mailpit (dev) or a real provider. Nothing in the app needs mail to work.
- SSH root login is on by default with a password you choose at provisioning; switch to a key and
  disable password login once you have signed in once.

## One-time host setup

```bash
# 1. Create a deployment user and give it sudo; SSH as that user from here on.
#    (Replace `deploy` with a name of your choice.)
adduser deploy
usermod -aG sudo deploy
ssh-copy-id deploy@your-host.example.org

# 2. If you want key-only login, edit /etc/ssh/sshd_config:
#       PasswordAuthentication no
#    then reload:  sudo systemctl reload ssh

# 3. Keep the Compose plugin up to date (it ships in the template, but the daemon is not):
sudo apt update
sudo apt upgrade -y
sudo systemctl enable --now docker
```

Every other step is the same as the plain-VPS guide, run as the `deploy` user.

## Deploying

```bash
# 1. Clone and set the secrets, with the public address substituted.
git clone https://github.com/nerdy-gerbil/printq.git
cd printq
cp .env.docker.example .env.docker

BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
DB_PASSWORD="$(openssl rand -hex 24)"

cat >> .env.docker <<EOF
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
DB_PASSWORD="${DB_PASSWORD}"
APP_URL=https://print.example.org
PASSKEY_RP_ID=print.example.org
DATA_ROOT=/opt/printq
EOF

# 2. Pull the images the stack consumes. They are public, so no registry login is needed.
docker compose --env-file .env.docker \
  -f docker-compose.prod.yml -f docker-compose.build.yml pull

# 3. Bring the stack up, and claim the printer at /setup in a browser.
docker compose --env-file .env.docker \
  -f docker-compose.prod.yml -f docker-compose.build.yml up -d

# 4. Verify before trusting it.
docker compose --env-file .env.docker -f docker-compose.prod.yml ps
docker compose --env-file .env.docker -f docker-compose.prod.yml logs migrate
docker compose --env-file .env.docker -f docker-compose.prod.yml logs app
#              ^ healthy          ^ ready for traffic
```

### Pins and rollback

`PRINTQ_TAG` in `.env.docker` defaults to `latest`. Pin it to a commit SHA so a re-pull is a
reproducible deploy — and so rollback is one command:

```bash
# find a tag
docker run --rm ghcr.io/nerdy-gerbil/printq-app:latest /bin/sh -c "echo \$PRINTQ_TAG"
# edit .env.docker, then:  docker compose up -d
```

Rollback after an outage: set `PRINTQ_TAG` to the previous SHA and `docker compose up -d` again.

## TLS in front

The app refuses plain HTTP in production and passkeys need a secure context, so a TLS terminator
is part of the deployment, not a nicety.

**Nginx Proxy Manager on the same host** is the quickest route. Join it to the compose network,
create a Proxy Host for `print.example.org` → `printq-app:3000`, request a Let's Encrypt
certificate with Force SSL on. Do not publish any host ports; the app is only reachable through
the proxy.

Alternatively use a **Cloudflare Tunnel**: `TRUST_PROXY_HEADERS=cloudflare` in `.env.docker`, a
tunnel whose Public Hostname points at `printq-app:3000`, and delete the old `A` record. Nothing
on the host needs a public address or a port forward.

Do not forget `client_max_body_size 300m` on Nginx Proxy Manager — the app accepts models up to
250 MB and the proxy's default is smaller, so a large upload fails at the proxy with a generic
error and nothing in the app log.

## Backup

Everything important lives under `DATA_ROOT` — `db/` (Postgres) and `uploads/` (models). A single
ZFS recursive snapshot of the parent dataset captures both, and it is the only thing that makes
restore cheap:

```bash
zfs snapshot -r tank/applications/printq@$(date +%F)
```

Losing `BETTER_AUTH_SECRET` invalidates every session; losing `DB_PASSWORD` locks the database.
Both belong in your backup, off the host. On a plain VPS you cannot reach the database from
outside anyway: the prod compose file publishes no host ports, so the only path in is the TLS
terminator.

## What to watch

Three commands, run now and then:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml ps       # exit 0 = all healthy
docker compose --env-file .env.docker -f docker-compose.prod.yml logs --tail=200
docker exec printq-db pg_dump -U printq -d printq > printq-$(date +%F).dump
```

The app starts a migrator one-shot on boot; if the stack never becomes healthy, read `docker logs
printq-migrate` first — a wrong `DB_PASSWORD` or an un-migrated schema is where freshly deployed
stacks go wrong.
