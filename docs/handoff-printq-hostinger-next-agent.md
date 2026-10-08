# Handoff: PrintQ / Hostinger deploy + Hostinger DB reconciliation

## Goal for the next agent
Keep iterating on the Hostinger deploy/build failure until the app builds and reaches a working state against the real Hostinger MariaDB database.

This is NOT a local-only task. The remaining work is mostly: read the Hostinger build output, compare it to the actual repo file contents, find the exact mismatch, and fix the specific place the build is still producing the wrong SQL.

## Current state
- The Hostinger deploy/build is still failing during `npm run build`.
- The build runs `npm run predeploy:db:reconcile`, which runs:
  - `tsx scripts/reconcile-hostinger-db.ts`
- The last pasted build failed with:
  - `Unknown data type: 'TEXTNOT'`
  - failing inside `scripts/reconcile-hostinger-db.ts` around `ensureColumn(...)`
- The build log says it checked out:
  - `3ff9f62` from `github.com/nerdy-gerbil/printq`, branch `main`
- The build environment looks like:
  - Node.js 22
  - npm
  - Next.js app type
  - output dir `.next`
  - build command `npm run build`

## What has been tried already
- A corrected `ALTER TABLE ... MODIFY ... TEXT NOT NULL` query was written into the repo for `account.issuer`.
- A narrower plain-DDL helper file was created for direct phpMyAdmin use:
  - `C:\Users\David\printq\scripts\reconcile-essential.sql`
- The Hostinger database side was partially reconciled through phpMyAdmin:
  - `account.issuer` appears to already exist
  - `user.username` and `user.displayUsername` appear to already exist
- Local verification was done on disk for the helper file.

## Key mismatch that still needs resolving
The build checked out the commit that is supposed to contain the fix, but the build log still shows the `TEXTNOT` failure.

That means one of these is true, and the next agent should determine which:

1. The build is running a different version of `scripts/reconcile-hostinger-db.ts` than the one documented on disk here.
2. The `MODIFY ... issuer ... TEXT NOT NULL` query path in the build still contains the typo, even if some other copy on disk looks correct.
3. The failing query is not coming from the code path we assumed, and the real failing query needs to be identified from the build output itself.

## What the next agent should do first
1. Re-read the exact failing build output, especially:
   - the full Prisma error block
   - the stack trace
   - any raw SQL the build printed around the failure
2. If possible, get the exact file contents from the build environment for:
   - `scripts/reconcile-hostinger-db.ts`
   - especially the `ensureColumn` function
   - especially the section that does the `MODIFY ... issuer ...` step
3. Search those build-source contents for the literal string `TEXTNOT`.
4. If `TEXTNOT` is present in the build source, find why that build source still has it despite the corrected commit being checked out.
5. If `TEXTNOT` is NOT in `scripts/reconcile-hostinger-db.ts` in the build, find the other query that is producing it.

## Scope of the real fix
The real fix is likely one of:
- correcting the exact typo still present in the build-time copy of `scripts/reconcile-hostinger-db.ts`
- or finding a second query path that also emits the bad syntax and correcting that too
- or confirming that the build is using a stale/cached copy and making the build use the corrected file

Do not spend effort polishing additional local helper scripts unless they directly help diagnose the build mismatch.

## Useful context from earlier work
- The Hostinger account appears restricted enough that `INFORMATION_SCHEMA` reads and some advanced SQL features are problematic in phpMyAdmin.
- That is why a fallback plain-DDL reconciliation file was created:
  - `C:\Users\David\printq\scripts\reconcile-essential.sql`
- The app-side script `scripts/reconcile-hostinger-db.ts` does schema inspection via `INFORMATION_SCHEMA` and then issues DDL through Prisma.

## Files to inspect
Local workspace:
- `C:\Users\David\printq\scripts\reconcile-hostinger-db.ts`
- `C:\Users\David\printq\scripts\reconcile-essential.sql`

From the build log, request/inspect:
- the exact checked-out file contents for `scripts/reconcile-hostinger-db.ts`
- the failing query text
- any relevant surrounding build environment notes

## Sensitive information
The project uses real Hostinger database credentials in the build environment.
Do NOT paste passwords, connection strings, or full DB URLs into any shared artifact.
Reference them only as “the Hostinger DB env vars” or similar.

## Suggested skills
- `handoff` — if this doc needs to be rewritten/refined for another handoff
- `triage` — if the remaining failure should be categorized and turned into a concise actionable brief
- `teach` — only if the next agent needs coaching on reading the Hostinger build log format or on the repo's reconciliation script structure
- `grill-me` — only if the remaining failure path needs a forced clarity pass before more changes are made

## Open questions
- Why does the build checked out from the corrected commit still execute a query containing `TEXTNOT`?
- Is the failing query in `scripts/reconcile-hostinger-db.ts` exactly as expected, or is there another query path involved?
- Is the build environment running a stale/copy of the script rather than the checked-out source?

## Done criteria
- The Hostinger build no longer fails with `Unknown data type: 'TEXTNOT'` during `predeploy:db:reconcile`.
- Preferably, the build also completes `npm run build` successfully against the real Hostinger database.
