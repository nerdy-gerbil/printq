#!/usr/bin/env tsx
/**
 * Bring a hand-built Hostinger MySQL schema up to schema.prisma, then remove
 * the broken admin user so /setup can create a clean admin.
 *
 * This is the script for the case where the database was created by hand in
 * MySQL and never migrated by Prisma. It reads the actual columns/tables that
 * exist first, and only adds what is missing — so a rerun is safe.
 *
 * What it does, in order:
 *  1. Checks that the database environment is present before importing Prisma,
 *     so a missing DB config fails the build with a readable message instead of
 *     a raw PrismaClientInitializationError.
 *  2. Connects with the same DATABASE_URL the app uses (DB_HOST/DB_NAME/DB_USER
 *     /DB_PASSWORD path or a direct DATABASE_URL).
 *  3. Creates any table the schema expects but the database does not have.
 *  4. Adds any column the schema expects but the table does not have.
 *  5. Backfills account.issuer from providerId, then makes it NOT NULL.
 *  6. Creates the unique indexes the schema expects.
 *  7. Seeds material_rate and machine_rate defaults if those tables were empty.
 *  8. Deletes user id cmuznegkk00017mcwlf6pas66 and lets the foreign-key
 *     cascades clean up the linked account/session/passkey rows.
 *  9. Recreates a placeholder admin when RECREATE_ADMIN is not explicitly false.
 *
 * The script is intentionally READ-ONLY in the inspection phase and only writes
 * after dumping the full plan. It never echoes the database password.
 *
 * Every statement it runs is printed first (DDL only — no rows, no credentials),
 * because the Hostinger build log is the only view anyone gets of this step. The
 * runtime error that first failed this build read `Unknown data type: 'TEXTNOT'`
 * and nothing else; with the statements printed, the next failure names itself.
 *
 * Set SKIP_DB_RECONCILE=true to skip the whole step — the escape hatch for a
 * host that should build without reaching the database at all.
 *
 * Set DRY_RUN=true (or pass --dry-run) to run the inspection and print the
 * whole plan without executing any of it. The plan is the only thing this
 * script knows that the schema files do not, so being able to read it before
 * it runs — against a live database, from anywhere — is worth the flag.
 * Unattended / build form: the script reads DB_HOST/DB_NAME/DB_USER/DB_PASSWORD
 * (or a direct DATABASE_URL). If the database environment is not present in this
 * build, or cannot be assembled into a valid URL, it prints a clear message and
 * exits non-zero.
 *
 * Run from the repo root:
 *   npx tsx scripts/reconcile-hostinger-db.ts
 *
 * If something is already correct it prints "already present" and moves on.
 * If the admin user is not present it prints "admin user not found" and skips
 * the delete.
 */

const REQUIRED_DB_VARS = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;

function missingDbVars(): Array<typeof REQUIRED_DB_VARS[number]> {
  return REQUIRED_DB_VARS.filter((k) => !process.env[k]?.trim());
}

const DRY_RUN =
  process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");

if (process.env.SKIP_DB_RECONCILE === "true") {
  console.log(
    "SKIP_DB_RECONCILE=true — skipping the database reconciliation step. " +
      "The app will start against whatever schema the database already has.",
  );
  process.exit(0);
}

const missing = missingDbVars();
if (missing.length > 0) {
  console.error(
    `Database environment is not configured for this build.\n` +
      `The DB reconciliation step needs all of: ${REQUIRED_DB_VARS.join(", ")}.\n` +
      `Missing: ${missing.join(", ")}.\n` +
      `Set them in the build environment (or set DATABASE_URL directly) and retry.\n` +
      `If this is a deploy that should skip the DB step, set SKIP_DB_RECONCILE=true.\n`,
  );
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";

import {
  addColumnSql,
  createIndexSql,
  createTableSql,
  modifyColumnSql,
  type ColumnSpec,
} from "./lib/ddl";

const client = new PrismaClient({
  log: ["warn", "error"],
});

// Resolve DATABASE_URL using the same assembly ./_env would, but do it here so
// a failure produces a readable build-failure message rather than a raw Prisma
// error. If it can't be assembled, this process has already exited above or will
// exit below.
function buildDatabaseUrl(): string {
  const supplied = process.env.DATABASE_URL?.trim();
  if (supplied) {
    try {
      new URL(supplied);
      return supplied;
    } catch {
      throw new Error(
        `DATABASE_URL is not a valid URL. If its password contains # / ? % @ : or spaces, ` +
          `percent-encode them (each character becomes %xx), or unset it and use ` +
          `DB_HOST, DB_NAME, DB_USER and DB_PASSWORD instead.`,
      );
    }
  }

  const host = process.env.DB_HOST?.trim();
  const name = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const pass = process.env.DB_PASSWORD?.trim();
  if (!host || !name || !user || !pass) {
    const missing = REQUIRED_DB_VARS.filter((k) => !process.env[k]?.trim());
    throw new Error(
      `DATABASE_URL is not set, and the Hostinger MySQL path is incomplete.\n` +
        `Set DATABASE_URL, or set all of: ${missing.join(", ")}.`,
    );
  }

  const withPort = /^(.+):(\d{1,5})$/.exec(host);
  const hostname = withPort?.[1] ?? host;
  const port = withPort?.[2] ?? "3306";

  const url =
    `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}` +
    `@${hostname}:${port}/${encodeURIComponent(name)}`;

  try {
    new URL(url);
    return url;
  } catch {
    throw new Error(
      `DB_HOST ("${hostname}") is not a hostname Prisma can parse. ` +
        `Set it to the MySQL host alone, e.g. mysqlXX.hostinger.com, with or without :port.`,
    );
  }
}

const resolvedDatabaseUrl = (() => {
  try {
    return buildDatabaseUrl();
  } catch (error) {
    console.error(
      `Database URL could not be assembled from the build environment.\n` +
        `The DB reconciliation step needs either DATABASE_URL, or all of: ` +
        `${REQUIRED_DB_VARS.join(", ")}.\n` +
        `Detail: ${(error as Error).message}`,
    );
    process.exit(1);
  }
})();

process.env.DATABASE_URL = resolvedDatabaseUrl;

const DELETE_ADMIN_ID = "cmuznegkk00017mcwlf6pas66";

const ADMIN_USER = process.env.ADMIN_USER?.trim() ?? "GeekyGerbil";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "dav.martinj@gmail.com";
const RECREATE_ADMIN = process.env.RECREATE_ADMIN !== "false";

type ColumnShape = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
};

type TableShape = {
  name: string;
  columns: ColumnShape[];
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
};

/**
 * Print a statement, then run it. The print is the point: DDL carries no rows
 * and no credentials, and a build log that shows the exact SQL turns a mystery
 * MySQL error into a named statement.
 */
async function run(sql: string): Promise<void> {
  console.log(`  ${DRY_RUN ? "[dry-run] " : ""}${sql.replace(/\s+/g, " ")}`);
  if (DRY_RUN) return;
  await client.$executeRawUnsafe(sql);
}

async function tableShape(name: string): Promise<TableShape | null> {
  const rows = await client.$queryRaw<Array<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
  }>>`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name}`;

  const indexes = await client.$queryRaw<Array<{
    INDEX_NAME: string;
    COLUMN_NAME: string;
    NON_UNIQUE: number;
  }>>`SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
   FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name} AND INDEX_NAME != "PRIMARY"`;

  const byIndex = new Map<string, { columns: string[]; unique: boolean }>();
  for (const row of indexes) {
    const entry = byIndex.get(row.INDEX_NAME) ?? { columns: [], unique: row.NON_UNIQUE === 0 };
    entry.columns.push(row.COLUMN_NAME);
    byIndex.set(row.INDEX_NAME, entry);
  }

  if (rows.length === 0) return null;

  return {
    name,
    columns: rows.map((r) => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === "YES",
      defaultValue: r.COLUMN_DEFAULT,
    })),
    indexes: [...byIndex.values()].map(({ columns, unique }) => ({
      name: columns.join("_"),
      columns,
      unique,
    })),
  };
}

function mysqlTypeFor(prismaType: string): string {
  if (prismaType === "String") return "TEXT";
  if (prismaType === "Int" || prismaType === "Float") return "DOUBLE PRECISION";
  if (prismaType === "Boolean") return "BOOLEAN";
  if (prismaType === "DateTime") return "DATETIME";
  if (prismaType === "Json") return "JSON";
  if (prismaType === "BigInt") return "BIGINT";
  return "TEXT";
}

function defaultValueSqlFor(model: string, field: string): string | null {
  if (field === "createdAt" || field === "updatedAt") return "CURRENT_TIMESTAMP";
  if (model === "user" && field === "role") return "'user'";
  if (model === "user" && field === "emailVerified") return "false";
  if (model === "user" && field === "banned") return "false";
  if (model === "user" && field === "initials") return "'??'";
  if (model === "session" && field === "expiresAt") return null;
  if (model === "invite" && field === "role") return "'user'";
  if (model === "invite" && field === "sentAt") return "CURRENT_TIMESTAMP";
  if (model === "notification" && field === "read") return "false";
  if (model === "material" && field === "active") return "true";
  if (model === "material" && field === "sortOrder") return "0";
  if (model === "story" && field === "quantity") return "1";
  if (model === "story" && field === "material") return "'PETG'";
  if (model === "story" && field === "note") return "''";
  if (model === "story" && field === "printSettings") return "''";
  if (model === "wishlistItem" && field === "note") return "''";
  if (model === "material_rate" && field === "updatedAt") return "CURRENT_TIMESTAMP";
  if (model === "machine_rate" && field === "updatedAt") return "CURRENT_TIMESTAMP";
  return null;
}

function columnPresent(
  shape: TableShape | null,
  name: string,
): boolean {
  return shape !== null && shape.columns.some((c) => c.name === name);
}

function indexPresent(
  shape: TableShape | null,
  columns: string[],
  unique: boolean,
): boolean {
  if (shape === null) return false;
  return shape.indexes.some(
    (ix) =>
      ix.unique === unique &&
      ix.columns.length === columns.length &&
      ix.columns.every((c) => columns.includes(c)),
  );
}

async function ensureTable(model: string, table: string, fields: Array<{
  name: string;
  type: string;
  required: boolean;
}>) {
  const shape = await tableShape(table);
  if (shape !== null) {
    console.log(`table ${table}: already present`);
    return;
  }

  const columns: ColumnSpec[] = fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required,
    default: defaultValueSqlFor(model, field.name),
  }));
  await run(createTableSql(table, columns));
  console.log(`table ${table}: created`);
}

async function ensureColumn(
  table: string,
  field: string,
  type: string,
  required: boolean,
) {
  const shape = await tableShape(table);
  if (columnPresent(shape, field)) {
    // Could refine to required-ness here, but the main failure mode is a
    // missing column, not a wrong nullability on an existing one.
    console.log(`column ${table}.${field}: already present`);
    return;
  }

  const column: ColumnSpec = {
    name: field,
    type,
    required,
    default: defaultValueSqlFor(table, field),
  };
  await run(addColumnSql(table, column));
  console.log(`column ${table}.${field}: added`);
}

async function ensureIndex(
  table: string,
  columns: string[],
  unique: boolean,
  name: string,
) {
  const shape = await tableShape(table);
  if (indexPresent(shape, columns, unique)) {
    console.log(`index ${table}.${name}: already present`);
    return;
  }
  await run(createIndexSql(table, columns, unique, name));
  console.log(`index ${table}.${name}: created`);
}

async function main() {
  console.log("inspecting current Hostinger schema...");
  const existingTables = await client.$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `;
  const present = new Set(existingTables.map((r) => r.TABLE_NAME));
  console.log(`tables present: ${present.size} — ${[...present].join(", ")}`);

  // ---------------------------------------------------------------------------
  // 3. Tables that must exist
  // ---------------------------------------------------------------------------
  await ensureTable("user", "user", [
    { name: "id", type: "TEXT", required: true },
    { name: "name", type: "TEXT", required: true },
    { name: "email", type: "TEXT", required: true },
    { name: "emailVerified", type: "BOOLEAN", required: false },
    { name: "image", type: "TEXT", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
    { name: "initials", type: "TEXT", required: false },
    { name: "role", type: "TEXT", required: false },
    { name: "invitedById", type: "TEXT", required: false },
    { name: "banned", type: "BOOLEAN", required: false },
    { name: "banReason", type: "TEXT", required: false },
    { name: "banExpires", type: "DATETIME", required: false },
    { name: "username", type: "TEXT", required: false },
    { name: "displayUsername", type: "TEXT", required: false },
  ]);

  await ensureTable("session", "session", [
    { name: "id", type: "TEXT", required: true },
    { name: "expiresAt", type: "DATETIME", required: true },
    { name: "token", type: "TEXT", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
    { name: "ipAddress", type: "TEXT", required: false },
    { name: "userAgent", type: "TEXT", required: false },
    { name: "userId", type: "TEXT", required: true },
    { name: "impersonatedBy", type: "TEXT", required: false },
  ]);

  await ensureTable("account", "account", [
    { name: "id", type: "TEXT", required: true },
    { name: "accountId", type: "TEXT", required: true },
    { name: "issuer", type: "TEXT", required: false },
    { name: "providerId", type: "TEXT", required: true },
    { name: "userId", type: "TEXT", required: true },
    { name: "accessToken", type: "TEXT", required: false },
    { name: "refreshToken", type: "TEXT", required: false },
    { name: "idToken", type: "TEXT", required: false },
    { name: "accessTokenExpiresAt", type: "DATETIME", required: false },
    { name: "refreshTokenExpiresAt", type: "DATETIME", required: false },
    { name: "scope", type: "TEXT", required: false },
    { name: "password", type: "TEXT", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("verification", "verification", [
    { name: "id", type: "TEXT", required: true },
    { name: "identifier", type: "TEXT", required: true },
    { name: "value", type: "TEXT", required: true },
    { name: "expiresAt", type: "DATETIME", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("passkey", "passkey", [
    { name: "id", type: "TEXT", required: true },
    { name: "name", type: "TEXT", required: false },
    { name: "publicKey", type: "TEXT", required: true },
    { name: "userId", type: "TEXT", required: true },
    { name: "credentialID", type: "TEXT", required: true },
    { name: "counter", type: "INTEGER", required: true },
    { name: "deviceType", type: "TEXT", required: true },
    { name: "backedUp", type: "BOOLEAN", required: true },
    { name: "transports", type: "TEXT", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "aaguid", type: "TEXT", required: false },
  ]);

  await ensureTable("rateLimit", "rateLimit", [
    { name: "id", type: "TEXT", required: true },
    { name: "key", type: "TEXT", required: true },
    { name: "count", type: "INTEGER", required: true },
    { name: "lastRequest", type: "BIGINT", required: true },
  ]);

  await ensureTable("invite", "invite", [
    { name: "id", type: "TEXT", required: true },
    { name: "email", type: "TEXT", required: true },
    { name: "tokenHash", type: "TEXT", required: true },
    { name: "name", type: "TEXT", required: false },
    { name: "role", type: "TEXT", required: false },
    { name: "invitedById", type: "TEXT", required: true },
    { name: "expiresAt", type: "DATETIME", required: true },
    { name: "acceptedAt", type: "DATETIME", required: false },
    { name: "revokedAt", type: "DATETIME", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "sentAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("auditEvent", "auditEvent", [
    { name: "id", type: "TEXT", required: true },
    { name: "at", type: "DATETIME", required: false },
    { name: "action", type: "TEXT", required: true },
    { name: "actorId", type: "TEXT", required: false },
    { name: "actorEmail", type: "TEXT", required: false },
    { name: "subject", type: "TEXT", required: false },
    { name: "ip", type: "TEXT", required: false },
    { name: "userAgent", type: "TEXT", required: false },
    { name: "detail", type: "JSON", required: false },
  ]);

  await ensureTable("story", "story", [
    { name: "id", type: "INTEGER", required: false },
    { name: "title", type: "TEXT", required: true },
    { name: "status", type: "TEXT", required: false },
    { name: "uploaderId", type: "TEXT", required: true },
    { name: "quantity", type: "INTEGER", required: false },
    { name: "material", type: "TEXT", required: false },
    { name: "colorName", type: "TEXT", required: true },
    { name: "colorHex", type: "TEXT", required: true },
    { name: "additionalColorNames", type: "JSON", required: false },
    { name: "sourceUrl", type: "TEXT", required: false },
    { name: "tip", type: "TEXT", required: true },
    { name: "note", type: "TEXT", required: false },
    { name: "printSettings", type: "TEXT", required: false },
    { name: "flagged", type: "BOOLEAN", required: false },
    { name: "flagReason", type: "TEXT", required: false },
    { name: "filename", type: "TEXT", required: true },
    { name: "fileSize", type: "INTEGER", required: true },
    { name: "mimeType", type: "TEXT", required: true },
    { name: "storageKey", type: "TEXT", required: true },
    { name: "dims", type: "TEXT", required: false },
    { name: "weightGrams", type: "INTEGER", required: false },
    { name: "printMinutes", type: "INTEGER", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("comment", "comment", [
    { name: "id", type: "TEXT", required: true },
    { name: "storyId", type: "INTEGER", required: true },
    { name: "authorId", type: "TEXT", required: true },
    { name: "body", type: "TEXT", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("notification", "notification", [
    { name: "id", type: "TEXT", required: true },
    { name: "recipientId", type: "TEXT", required: true },
    { name: "storyId", type: "INTEGER", required: false },
    { name: "featureId", type: "INTEGER", required: false },
    { name: "text", type: "TEXT", required: true },
    { name: "read", type: "BOOLEAN", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("material", "material", [
    { name: "id", type: "TEXT", required: true },
    { name: "name", type: "TEXT", required: true },
    { name: "active", type: "BOOLEAN", required: false },
    { name: "sortOrder", type: "INTEGER", required: false },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("material_rate", "material_rate", [
    { name: "material", type: "TEXT", required: true },
    { name: "dollarsPerKg", type: "DOUBLE PRECISION", required: true },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("machine_rate", "machine_rate", [
    { name: "id", type: "TEXT", required: false },
    { name: "dollarsPerHour", type: "DOUBLE PRECISION", required: true },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("wishlistItem", "wishlistItem", [
    { name: "id", type: "TEXT", required: true },
    { name: "url", type: "TEXT", required: true },
    { name: "title", type: "TEXT", required: true },
    { name: "thumbnailKey", type: "TEXT", required: false },
    { name: "source", type: "TEXT", required: true },
    { name: "note", type: "TEXT", required: false },
    { name: "addedById", type: "TEXT", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("featureRequest", "featureRequest", [
    { name: "id", type: "INTEGER", required: false },
    { name: "title", type: "TEXT", required: true },
    { name: "description", type: "TEXT", required: false },
    { name: "status", type: "TEXT", required: false },
    { name: "priority", type: "TEXT", required: false },
    { name: "category", type: "TEXT", required: false },
    { name: "requesterId", type: "TEXT", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
    { name: "updatedAt", type: "DATETIME", required: false },
  ]);

  await ensureTable("featureComment", "featureComment", [
    { name: "id", type: "TEXT", required: true },
    { name: "featureId", type: "INTEGER", required: true },
    { name: "authorId", type: "TEXT", required: true },
    { name: "body", type: "TEXT", required: true },
    { name: "createdAt", type: "DATETIME", required: false },
  ]);

  // ---------------------------------------------------------------------------
  // 4. Columns the table exists for but may be missing
  // ---------------------------------------------------------------------------
  await ensureColumn("user", "username", "TEXT", false);
  await ensureColumn("user", "displayUsername", "TEXT", false);
  await ensureColumn("account", "issuer", "TEXT", false);
  await ensureColumn("notification", "featureId", "INTEGER", false);
  await ensureColumn("notification", "text", "TEXT", true);
  await ensureColumn("notification", "read", "BOOLEAN", false);
  await ensureColumn("story", "weightGrams", "INTEGER", false);
  await ensureColumn("story", "printMinutes", "INTEGER", false);
  await ensureColumn("story", "additionalColorNames", "JSON", false);
  await ensureColumn("story", "sourceUrl", "TEXT", false);
  await ensureColumn("story", "printSettings", "TEXT", false);
  await ensureColumn("story", "dims", "TEXT", false);
  await ensureColumn("story", "flagged", "BOOLEAN", false);
  await ensureColumn("story", "flagReason", "TEXT", false);
  await ensureColumn("story", "material", "TEXT", false);
  await ensureColumn("story", "note", "TEXT", false);
  await ensureColumn("story", "quantity", "INTEGER", false);
  await ensureColumn("story", "colorName", "TEXT", true);
  await ensureColumn("story", "colorHex", "TEXT", true);
  await ensureColumn("story", "tip", "TEXT", true);
  await ensureColumn("story", "filename", "TEXT", true);
  await ensureColumn("story", "fileSize", "INTEGER", true);
  await ensureColumn("story", "mimeType", "TEXT", true);
  await ensureColumn("story", "storageKey", "TEXT", true);
  await ensureColumn("wishlistItem", "thumbnailKey", "TEXT", false);
  await ensureColumn("wishlistItem", "note", "TEXT", false);
  await ensureColumn("wishlistItem", "source", "TEXT", true);
  await ensureColumn("wishlistItem", "title", "TEXT", true);
  await ensureColumn("wishlistItem", "url", "TEXT", true);
  await ensureColumn("wishlistItem", "id", "TEXT", true);
  await ensureColumn("featureRequest", "description", "TEXT", false);
  await ensureColumn("featureRequest", "status", "TEXT", false);
  await ensureColumn("featureRequest", "priority", "TEXT", false);
  await ensureColumn("featureRequest", "category", "TEXT", false);
  await ensureColumn("featureRequest", "title", "TEXT", true);
  await ensureColumn("featureRequest", "id", "INTEGER", false);
  await ensureColumn("featureRequest", "requesterId", "TEXT", true);
  await ensureColumn("featureComment", "body", "TEXT", true);
  await ensureColumn("featureComment", "featureId", "INTEGER", true);
  await ensureColumn("featureComment", "authorId", "TEXT", true);
  await ensureColumn("featureComment", "id", "TEXT", true);
  await ensureColumn("auditEvent", "action", "TEXT", true);
  await ensureColumn("auditEvent", "actorEmail", "TEXT", false);
  await ensureColumn("auditEvent", "subject", "TEXT", false);
  await ensureColumn("auditEvent", "ip", "TEXT", false);
  await ensureColumn("auditEvent", "userAgent", "TEXT", false);
  await ensureColumn("auditEvent", "detail", "JSON", false);
  await ensureColumn("auditEvent", "at", "DATETIME", false);
  await ensureColumn("auditEvent", "actorId", "TEXT", false);
  await ensureColumn("rateLimit", "key", "TEXT", true);
  await ensureColumn("rateLimit", "count", "INTEGER", true);
  await ensureColumn("rateLimit", "lastRequest", "BIGINT", true);
  await ensureColumn("rateLimit", "id", "TEXT", true);
  await ensureColumn("invite", "tokenHash", "TEXT", true);
  await ensureColumn("invite", "name", "TEXT", false);
  await ensureColumn("invite", "role", "TEXT", false);
  await ensureColumn("invite", "invitedById", "TEXT", true);
  await ensureColumn("invite", "expiresAt", "DATETIME", true);
  await ensureColumn("invite", "acceptedAt", "DATETIME", false);
  await ensureColumn("invite", "revokedAt", "DATETIME", false);
  await ensureColumn("invite", "sentAt", "DATETIME", false);
  await ensureColumn("verification", "identifier", "TEXT", true);
  await ensureColumn("verification", "value", "TEXT", true);
  await ensureColumn("verification", "expiresAt", "DATETIME", true);
  await ensureColumn("passkey", "name", "TEXT", false);
  await ensureColumn("passkey", "publicKey", "TEXT", true);
  await ensureColumn("passkey", "userId", "TEXT", true);
  await ensureColumn("passkey", "credentialID", "TEXT", true);
  await ensureColumn("passkey", "counter", "INTEGER", true);
  await ensureColumn("passkey", "deviceType", "TEXT", true);
  await ensureColumn("passkey", "backedUp", "BOOLEAN", true);
  await ensureColumn("passkey", "transports", "TEXT", false);
  await ensureColumn("passkey", "aaguid", "TEXT", false);
  await ensureColumn("session", "ipAddress", "TEXT", false);
  await ensureColumn("session", "userAgent", "TEXT", false);
  await ensureColumn("session", "impersonatedBy", "TEXT", false);

  // ---------------------------------------------------------------------------
  // 5. Backfill account.issuer
  // ---------------------------------------------------------------------------
  const accountShape = await tableShape("account");
  if (accountShape !== null && !accountShape.columns.some((c) => c.name === "issuer")) {
    console.log("account.issuer missing — skipping backfill (column should have been added above)");
  } else {
    const issuerCount = await client.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM account WHERE issuer IS NULL
    `;
    const missing = issuerCount[0]?.n ?? 0;
    if (missing > 0) {
      await run(
        `UPDATE account SET issuer = CONCAT('local:', providerId) WHERE issuer IS NULL;`,
      );
      console.log(`account.issuer backfilled ${missing} row(s)`);
    } else {
      console.log("account.issuer already populated");
    }

    // Make it NOT NULL if it isn't already.
    if (accountShape !== null && accountShape.columns.some((c) => c.name === "issuer" && c.nullable)) {
      await run(modifyColumnSql("account", { name: "issuer", type: "TEXT", required: true }));
      console.log("account.issuer set to NOT NULL");
    } else {
      console.log("account.issuer already NOT NULL");
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Indexes
  // ---------------------------------------------------------------------------
  await ensureIndex("user", ["email"], true, "user_email_key");
  await ensureIndex("user", ["role"], false, "user_role_idx");
  await ensureIndex("session", ["token"], true, "session_token_key");
  await ensureIndex("session", ["userId"], false, "session_userId_idx");
  await ensureIndex("account", ["userId"], false, "account_userId_idx");
  await ensureIndex("account", ["issuer", "accountId"], true, "account_issuer_accountId_key");
  await ensureIndex("verification", ["identifier"], false, "verification_identifier_idx");
  await ensureIndex("passkey", ["userId"], false, "passkey_userId_idx");
  await ensureIndex("passkey", ["credentialID"], false, "passkey_credentialID_idx");
  await ensureIndex("invite", ["tokenHash"], true, "invite_tokenHash_key");
  await ensureIndex("invite", ["email"], false, "invite_email_idx");
  await ensureIndex("invite", ["expiresAt"], false, "invite_expiresAt_idx");
  await ensureIndex("story", ["uploaderId"], false, "story_uploaderId_idx");
  await ensureIndex("story", ["status"], false, "story_status_idx");
  await ensureIndex("comment", ["storyId"], false, "comment_storyId_idx");
  await ensureIndex("notification", ["recipientId", "read"], false, "notification_recipientId_read_idx");
  await ensureIndex("material", ["name"], true, "material_name_key");
  await ensureIndex("material", ["active", "sortOrder"], false, "material_active_sortOrder_idx");
  await ensureIndex("wishlistItem", ["url"], true, "wishlistItem_url_key");
  await ensureIndex("wishlistItem", ["createdAt"], false, "wishlistItem_createdAt_idx");
  await ensureIndex("wishlistItem", ["addedById"], false, "wishlistItem_addedById_idx");
  await ensureIndex("featureRequest", ["requesterId"], false, "featureRequest_requesterId_idx");
  await ensureIndex("featureRequest", ["status"], false, "featureRequest_status_idx");

  // ---------------------------------------------------------------------------
  // 7. Seed material_rate / machine_rate if those tables were empty
  // ---------------------------------------------------------------------------
  const rateCount = await client.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*) AS n FROM material_rate
  `;
  if ((rateCount[0]?.n ?? 0) === 0) {
    await run(`
      INSERT INTO material_rate (material, dollarsPerKg, updatedAt) VALUES
        ('PLA', 20.0, CURRENT_TIMESTAMP),
        ('PETG', 22.0, CURRENT_TIMESTAMP),
        ('TPU', 28.0, CURRENT_TIMESTAMP),
        ('Resin', 45.0, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE updatedAt = CURRENT_TIMESTAMP
    `);
    console.log("material_rate seeded with defaults");
  } else {
    console.log("material_rate already has rows");
  }

  const machineCount = await client.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*) AS n FROM machine_rate
  `;
  if ((machineCount[0]?.n ?? 0) === 0) {
    await run(`
      INSERT INTO machine_rate (id, dollarsPerHour, updatedAt) VALUES
        ('default', 0.75, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE updatedAt = CURRENT_TIMESTAMP
    `);
    console.log("machine_rate seeded with defaults");
  } else {
    console.log("machine_rate already has rows");
  }

  // ---------------------------------------------------------------------------
  // 8. Drop the broken admin user
  // ---------------------------------------------------------------------------
  const admin = await client.user.findUnique({
    where: { id: DELETE_ADMIN_ID },
    select: { id: true, email: true, name: true, role: true },
  });
  if (admin === null) {
    console.log(`admin user ${DELETE_ADMIN_ID} not found — nothing to delete`);
  } else if (DRY_RUN) {
    console.log(
      `[dry-run] would delete broken admin user ${DELETE_ADMIN_ID} ` +
        `(${admin.email}, ${admin.name}, ${admin.role})`,
    );
  } else {
    console.log(
      `deleting broken admin user ${DELETE_ADMIN_ID} (${admin.email}, ${admin.name}, ${admin.role}) —`,
    );
    await client.user.delete({ where: { id: DELETE_ADMIN_ID } });
    console.log("admin user deleted — cascades should have cleaned account/session/passkey");
  }

  // ---------------------------------------------------------------------------
  // 9. Recreate the admin if we just deleted it and RECREATE_ADMIN is on
  // ---------------------------------------------------------------------------
  if (RECREATE_ADMIN) {
    const existingAdmin = await client.user.findFirst({
      where: { role: "admin" },
      select: { id: true, email: true },
    });
    if (existingAdmin === null && DRY_RUN) {
      console.log(
        `[dry-run] would create an admin placeholder for ${ADMIN_EMAIL} — ` +
          `run /setup to set the password once the deploy is real`,
      );
    } else if (existingAdmin === null) {
      // The setup action writes user + account together. Replicate just enough
      // of that shape here so sign-in works once the admin picks a password at
      // /setup — we do not invent a password here, so the account row is left
      // without a credential digest until /setup runs. Better Auth will still
      // accept a sign-in once /setup has populated the credential account.
      const userId: string = await client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: ADMIN_USER,
            email: ADMIN_EMAIL,
            emailVerified: true,
            initials: ADMIN_USER
              .toUpperCase()
              .slice(0, 2)
              .replace(/[^A-Z]/g, "?"),
            role: "admin",
            invitedById: null,
          },
          select: { id: true },
        });
        await tx.account.create({
          data: {
            accountId: userId,
            issuer: "local:credential",
            providerId: "credential",
            userId,
            password: null,
          },
        });
        return userId;
      });
      console.log(
        `admin placeholder created: ${userId} (${ADMIN_EMAIL}) — run /setup to ` +
          `set the password and finalise the credential account`,
      );
    } else {
      console.log(
        `admin already present: ${existingAdmin.id} (${existingAdmin.email}) — ` +
          `not recreating`,
      );
    }
  } else {
    console.log("RECREATE_ADMIN=false — skipping admin creation");
  }

  await client.$disconnect();
  console.log("done");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
