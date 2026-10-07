import { PrismaClient } from "@prisma/client";

/**
 * Next.js dev server hot-reloads modules, which would otherwise open a new
 * connection pool on every edit until Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The Prisma client. In production this is the one the whole app shares.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// On Hostinger Business we do not set DATABASE_URL directly; instead we supply
// the four MySQL connection parts (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) and
// assemble it here, before Prisma evaluates its datasource
// url = env("DATABASE_URL"). When DATABASE_URL is already set (compose/docker path)
// we leave it alone.
//
// This has to run before any PrismaClient is constructed, which is why it lives
// in this module rather than somewhere the app might import later.

function buildHostingerUrl(): string {
  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASSWORD;

  if (!host || !name || !user || !pass) {
    const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter(
      (k) => !process.env[k],
    );
    throw new Error(
      `DATABASE_URL is not set, and the Hostinger MySQL path is incomplete.\r\n` +
        `Set DATABASE_URL, or set all of: ${missing.join(", ")}`,
    );
  }

  return `mysql://${user}:${pass}@${host}:3306/${name}`;
}

const url = process.env.DATABASE_URL ?? buildHostingerUrl();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = url;
}
