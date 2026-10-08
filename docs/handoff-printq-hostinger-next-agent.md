# Handoff: PrintQ / Hostinger deploy — the `TEXTNOT` build failure, resolved

**Status: root cause found, fixed, and the fix's SQL verified against the real database.** The
reconciliation has not yet been run *by the fixed code* against the live schema — see
*What remains* — but the statements it will run were executed against the real server (MariaDB
11.8.9), and the live schema was inspected directly, so what the next deploy will do is known.

## The root cause, in one line

`scripts/reconcile-hostinger-db.ts` built column definitions by interpolating clauses with **no
separator between them**, so a required `TEXT` column emitted `TEXTNOT NULL` — and MySQL answered
`Unknown data type: 'TEXTNOT'`.

```ts
// before — ensureColumn(...), and the same shape in ensureTable(...)
const nullable = required ? "NOT NULL" : "";
const def = defaultValueSqlFor(table, field);
const defaultSql = def !== null ? ` DEFAULT ${def}` : "";
await client.$executeRawUnsafe(
  `ALTER TABLE \`${table}\` ADD COLUMN \`${field}\` ${type}${nullable}${defaultSql};`,
);
```

`${type}${nullable}` with `type = "TEXT"` and `required = true` is the whole bug. There is no
`TEXTNOT` anywhere in the source — the missing character is a space at a concatenation boundary —
which is why two commits aimed at it both missed:

- `fbb0d88` "Fix MySQL syntax typo in account.issuer NOT NULL migration" edited the
  `ALTER TABLE account MODIFY issuer TEXT NOT NULL` string. That string was never broken: it is a
  literal with its spaces present, and it is not on the failing path.
- `3ff9f62` "Fix line-wrap that hid the TEXTNOT typo from the last edit" rewrapped the line.

## The host's own build log, which proves it

`~/domains/printq.hivecodelabs.com/hbuilds/logs/<build-id>/<timestamp>_deploy.log` — the build that
was reported as failing checked out `7bbe0bc`, walked the whole schema reporting `already present`,
and then died on the first column it actually had to add:

```
column notification.featureId: already present
prisma:error
Invalid `prisma.$executeRawUnsafe()` invocation:
Raw query failed. Code: `4161`. Message: `Unknown data type: 'TEXTNOT'`
    at async ensureColumn (.../scripts/reconcile-hostinger-db.ts:288:3)
    at async main (.../scripts/reconcile-hostinger-db.ts:535:3)
ERROR: Failed to build the application
```

Line 535 in that revision is `await ensureColumn("notification", "text", "TEXT", true)` — a required
`TEXT` column, on the first ADD COLUMN the reconciliation reaches. It is the bug, in the act.

## What changed in this workspace

| File | Change |
| --- | --- |
| `scripts/lib/ddl.ts` | **New.** Every statement is assembled here, each clause joined with exactly one space. `assertNoGluedKeyword` throws on the glued shape (`TEXTNOT`, `INTEGERDEFAULT`, `${a}${b}`) so a future edit cannot reintroduce it. Pure — no database, no credentials. |
| `scripts/reconcile-hostinger-db.ts` | Uses those builders for `CREATE TABLE` / `ADD COLUMN` / `MODIFY` / `CREATE INDEX`; prints every statement before it runs (DDL only — no rows, no credentials), so a build log now names its own failure; `SKIP_DB_RECONCILE=true` actually skips the step (the script's error text had been promising it with nothing behind it); `DRY_RUN=true` or `--dry-run` runs the whole inspection and prints the whole plan without writing anything. |
| `scripts/verify-ddl.ts` | **New.** 12 cases, no database: the statements that broke, the type × nullability × default matrix against an independently built expectation, two controls on the guard, and a pin on the real script (no `TEXTNOT`, no DDL built in its own templates). |
| `package.json` | `npm run verify:ddl`. |
| `.github/workflows/ci.yml` | `verify:ddl` runs in the `guard` job. It would have failed on `3ff9f62`. |

## How it was verified

Locally: `verify:ddl` 12/12, `npm run typecheck` clean, `check:links` clean, and the script through its
real entry point (skip flag → exit 0; no environment → the readable message and exit 1; fake DB vars →
Prisma reaches the connection stage).

**Against the real server**, over SSH on the host, with a probe generated from `scripts/lib/ddl.ts`
and executed through the `mysql` client — every statement on **temporary tables**, so no production
table was touched:

- `SELECT @@version` → `11.8.9-MariaDB-log`; `@@sql_mode` → `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`
  (not strict).
- 35 `ALTER TABLE ... ADD COLUMN` statements across every type × nullability × per-type default the
  script can emit: all accepted, no errors, `PROBE COMPLETE` reached, `mysql` exit 0.
- `CREATE TABLE` with the same column shapes, `ALTER TABLE ... MODIFY ... TEXT NOT NULL`, and both
  index forms: accepted. The only note was `1071: Specified key was too long; max key length is 3072
  bytes`, from indexing bare `TEXT` columns; the real composite index already exists and `ensureIndex`
  skips present indexes, so it does not fire on a deploy.
- The live schema was then read directly. **18 tables, complete except one column**:
  - `notification` is missing `text` — exactly what the fixed script will add.
  - `notification` contains a junk column whose *name* is `VARCHAR(191)`, left by a hand-run ALTER in
    phpMyAdmin. Nothing reads it; it should be dropped once the deploy is green.
  - `account.issuer` is already `TEXT NOT NULL`, and `user.username`, `user.displayUsername`,
    `notification.featureId`, and every `story`/`wishlistItem` column the script checks is present.
  - `notification` has 0 rows, so the `ADD COLUMN ... NOT NULL` cannot fail on existing data.
- The live app answers `https://printq.hivecodelabs.com/api/health` with `200 {"ok":true}`.

So the next deploy's reconciliation should do one thing — add `notification.text` — and print it.

## What remains

1. **Push and watch the build.** The reconciliation now prints each statement, so the log will show
   the one `ALTER TABLE notification ADD COLUMN text TEXT NOT NULL;` and then `next build` should
   proceed. Nothing has been committed or pushed from this workspace.
2. **Not verified: the fixed script executed end-to-end against the live database.** Prisma's query
   engine cannot start from an interactive SSH session on this host — `$queryRaw` triggers a Rust
   panic, `PANIC: timer has gone away`, on the very first query, with the engine loading fine. The
   deploy's own build clearly *can* run Prisma (its log shows queries and DDL reaching MySQL), so
   this is a property of the SSH session's environment (CageFS limits), not of the code — but it means
   the reconcile cannot be run by hand from a shell on this host. Run it as the deploy does, or from a
   machine that can reach the database.
3. **Consider dropping the junk `VARCHAR(191)` column** in `notification` after the deploy is green.
4. **`SKIP_DB_RECONCILE=true`** in the app's environment panel takes the build past the DB step
   entirely, if it should not run on the host at all.

## Second landmine on this path: `prisma migrate deploy` cannot work on Hostinger MySQL

`docs/hostinger-deployment.md` tells you to run `npx prisma migrate deploy` against the Hostinger
database. **It cannot succeed**, because `prisma/migrations/` is still PostgreSQL SQL while
`prisma/migrations/migration_lock.toml` and `prisma/schema.prisma` say `mysql`:

- `20260822093720_init/migration.sql` — `CREATE TYPE "Role" AS ENUM (...)`, `"id" TEXT NOT NULL`,
  `TIMESTAMP(3)`.
- `20260823154500_account_issuer/migration.sql` — `ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT
  NULL`, `'local:' || "providerId"`.
- `20261001000000_printq_roles_materials_costs_wishlist/migration.sql` — `TEXT[] NOT NULL DEFAULT
  ARRAY[]::TEXT[]`.

Double-quoted identifiers are not identifiers on MySQL, `CREATE TYPE` does not exist, and `||` does not
concatenate. Prisma would record the first failure in `_prisma_migrations` and every later
`migrate deploy` would refuse. The reconciliation script is the workaround that exists because of this;
the documentation has not caught up. Either rewrite the migration history as a MySQL baseline and fix
the doc, or make the reconciliation the documented first-run path for this host.

## SSH access to the host (owner's)

- `ssh -p 65002 -i ~/.ssh/printq_hostinger u678003261@82.29.191.45` — key only, no password. Private
  key lives outside the repository; delete the public key in hPanel to revoke.
- Node is not on the SSH `PATH`; versioned runtimes live under `/opt/alt/alt-nodejsNN/root/usr/bin/node`
  (Node 22 for this app). `tsx` is at
  `<domain>/hbuilds/source/repository/node_modules/tsx/dist/cli.mjs`, and a scratch `package.json` with
  `"type": "module"` is needed beside any script run outside the repo, or tsx emits CJS and dies on
  top-level await.
- The app's environment is `<domain>/hbuilds/config/.env` (mode 600). Source it in-shell; never print
  it. `DB_HOST` carries its port (`127.0.0.1:3306`) and the `mysql` client needs it split into
  `-h`/`-P`.
- Build logs: `<domain>/hbuilds/logs/<build-id>/<timestamp>_deploy.log`. The checkout for a build is
  `<domain>/hbuilds/source/repository`; the running app is under `hbuilds/current/nodejs`.
- The host resets SSH connections when they come too fast — batch commands, don't loop.

## Files

- `scripts/lib/ddl.ts` — the DDL, in one place.
- `scripts/reconcile-hostinger-db.ts` — the reconciliation itself.
- `scripts/verify-ddl.ts` — the no-database regression check.
- `scripts/reconcile-essential.sql` — the plain-DDL fallback for phpMyAdmin, kept for manual use.
