# Handoff: PrintQ / Hostinger deploy — the `TEXTNOT` build failure, resolved

**Status: the fix is pushed and running on the host, and it has already repaired the live database.**
The reconciliation now reaches its final step; the remaining failure was in admin bootstrap (see
*Third failure*), and the placeholder-admin step is now opt-in because it contradicted the documented
first-run flow.
The first deploy after it got past the failure it was written for — `ALTER TABLE notification ADD
COLUMN text TEXT NOT NULL;` ran, and `column notification.text: added` is in the build log — and then
hit a *second* bug one step later, in index detection, which is fixed in the following commit (see
*Second failure: reading NON_UNIQUE* below).

Do not treat "it got further" as "it is done": as of the last build the reconciliation had not yet
reached `prisma generate && next build`.

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

## Second failure: reading `NON_UNIQUE` (§ fixed in `scripts/lib/schema-shape.ts`)

With `TEXTNOT` gone, the build failed one step later, on the first index check:

```
  CREATE UNIQUE INDEX `user_email_key` ON `user` (`email`);
Raw query failed. Code: `1061`. Message: `Duplicate key name 'user_email_key'`
    at async run (.../scripts/reconcile-hostinger-db.ts:189:3)
    at async ensureIndex (.../scripts/reconcile-hostinger-db.ts:344:3)
```

That index exists, and it is unique — so the *detection* was wrong, not the DDL. The cause is a type:
`INFORMATION_SCHEMA.STATISTICS.NON_UNIQUE` is declared **`bigint(1)`** on MariaDB 11.8, Prisma's
`$queryRaw` hands a BIGINT back as a **`BigInt`**, and the script compared it to the number 0:
`0n === 0` is `false`. Every index was therefore recorded as non-unique, every *unique* index was
judged missing, and `CREATE UNIQUE INDEX` was issued for one that already existed.

The fix coerces (`Number(row.NON_UNIQUE) === 0`) in a pure helper, `indexesFromStatisticRows`, with
`verify-ddl.ts` pinning a `0n` row and a control proving the old comparison really failed. `ensureIndex`
also now tolerates a **name clash with a different shape**: it prints the difference and carries on
instead of failing the whole build on `Duplicate key name`, because this database was hand-built and
an index someone else created is theirs to review — nothing is dropped or altered.

The `STATISTICS` query also gained `ORDER BY INDEX_NAME, SEQ_IN_INDEX`, so a composite index's columns
come back in the index's own order rather than whatever the server felt like.

## Third failure: admin bootstrap, and a step that contradicted `/setup`

With the schema reconciled, the next build walked the whole script and died at its last step:

```
deleting broken admin user cmuznegkk00017mcwlf6pas66 (dav.martinj@gmail.com, David Martín, admin) —
admin user deleted — cascades should have cleaned account/session/passkey
ReferenceError: Cannot access 'userId' before initialization
    at <anonymous> (.../scripts/reconcile-hostinger-db.ts:792:24)
    at async Proxy._transactionWithCallback (.../node_modules/@prisma/client/...)
```

The account row was built with `accountId: userId` **inside the transaction callback that defines
`userId`** — a temporal dead zone, so the transaction threw. Because step 8 had already committed the
delete, the database was left with **no admin at all**.

Two things came out of it:

1. The sequence now lives in `scripts/lib/admin-bootstrap.ts`, taking the id from the row it just
   created, with the two writes injected so `verify-ddl.ts` drives them and asserts the account is keyed
   by the new user's id. The bug was unreachable by any test while it was inline in a callback.
2. **The placeholder admin is now opt-in** (`RECREATE_ADMIN=true`). It was on by default, which fought
   the rest of the system: `needsSetup()` is `count(role = 'admin') === 0`, so a placeholder makes
   `/setup` answer *"already set up. Sign in instead."* — and the placeholder has no password digest,
   while `prisma/seed.ts` deliberately prints no set-password link ("the set-password link the seed used
   to print was one more moving part"). Step 8 deletes the broken admin "so /setup can create a clean
   admin"; step 9 then blocked that. A deploy that ran it left a deployment nobody could sign in to and
   no way to claim it.

## What changed in this workspace

| File | Change |
| --- | --- |
| `scripts/lib/admin-bootstrap.ts` | **New.** The admin placeholder sequence, id taken from the created row, both writes injectable so the ordering bug above cannot come back untested. |
| `scripts/lib/schema-shape.ts` | **New.** Reading the live schema back out of `INFORMATION_SCHEMA`: the `NON_UNIQUE` coercion and the index-shape helpers, pure so they can be pinned without a database. |
| `scripts/lib/ddl.ts` | **New.** Every statement is assembled here, each clause joined with exactly one space. `assertNoGluedKeyword` throws on the glued shape (`TEXTNOT`, `INTEGERDEFAULT`, `${a}${b}`) so a future edit cannot reintroduce it. Pure — no database, no credentials. |
| `scripts/reconcile-hostinger-db.ts` | Uses those builders for `CREATE TABLE` / `ADD COLUMN` / `MODIFY` / `CREATE INDEX`; prints every statement before it runs (DDL only — no rows, no credentials), so a build log now names its own failure; `SKIP_DB_RECONCILE=true` actually skips the step (the script's error text had been promising it with nothing behind it); `DRY_RUN=true` or `--dry-run` runs the whole inspection and prints the whole plan without writing anything. |
| `scripts/verify-ddl.ts` | **New.** 17 cases, no database: the statements that broke, the type × nullability × default matrix against an independently built expectation, controls on the guard, the `NON_UNIQUE` shapes (BigInt, number, string) with a control for the comparison that failed, composite-index collapse, and a pin on the real script (no `TEXTNOT`, no DDL built in its own templates). |
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

That prediction was right, and the first pushed build confirmed it: the reconciliation added
`notification.text` for real, and then failed in index detection (above). After that fix, every one of
the ~23 indexes the reconciliation asks for was verified present with the right columns *and* the
right uniqueness, so the index section should report `already present` throughout and the build should
reach `prisma generate && next build`.

## What remains

1. **Watch the next build.** Everything the reconciliation asks for is now either present or fixed;
   if it succeeds, the remaining risk moves to `next build` itself (which has never run on this host
   against a MySQL schema — `prisma generate` and the Next.js compile are next in line).
2. **The first admin is claimed at `/setup`.** The database currently holds **no admin**: the failed
   build deleted the broken one and never replaced it. That is the good state — `/setup` is claimable
   on the live site right now, and the reconciliation no longer creates anything that would block it.
   If a placeholder is ever wanted, `RECREATE_ADMIN=true` in the app's environment panel.
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
