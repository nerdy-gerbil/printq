/**
 * Print the assembled, validated DATABASE_URL.
 *
 * The Prisma CLI (`prisma migrate deploy`) and prisma/seed.ts read one
 * variable — DATABASE_URL — and never see DB_HOST/DB_NAME/DB_USER/DB_PASSWORD,
 * which only the app (src/lib/db.ts) and the scripts importing ./_env
 * understand. This bridges the four parts through that same assembly
 * (percent-encoded credentials, port taken from DB_HOST when present, a
 * named error for anything unparsable), so the migration steps in the docs
 * can run against the Hostinger database:
 *
 *   export DATABASE_URL="$(npx tsx scripts/db-url.ts)"
 *
 * Errors go to stderr with a non-zero exit, so a failed run leaves
 * DATABASE_URL empty instead of half-set.
 */
import { DATABASE_URL } from "./_env";

process.stdout.write(`${DATABASE_URL}\n`);
