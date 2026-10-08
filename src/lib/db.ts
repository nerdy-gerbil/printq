/**
 * This module's only job, before anything else, is to make sure
 * `DATABASE_URL` is populated so that `@prisma/client` — imported here
 * and everywhere else — finds it when it evaluates its datasource URL.
 *
 * On Hostinger Business the four MySQL connection parts
 * (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) are supplied instead of a
 * raw DATABASE_URL, and we assemble it here. When DATABASE_URL is already
 * set (compose/docker path) we leave it alone.
 *
 * This MUST run before any PrismaClient is constructed, which is why the
 * assembly code runs first in this module.
 */

/**
 * Check the URL before Prisma ever sees it. Prisma reports a malformed URL
 * only as `invalid port number in database URL`, which points at no variable
 * and is frequently not about the port at all.
 */
function assertParseable(url: string, complaint: string): void {
  try {
    new URL(url);
  } catch {
    // Never echo the password back.
    throw new Error(`${complaint}\nThe URL in question: ${url.replace(/\/\/[^@]*@/, "//***@")}`);
  }
}

function buildHostingerUrl(): string {
  const host = process.env.DB_HOST?.trim();
  const name = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const pass = process.env.DB_PASSWORD?.trim();

  if (!host || !name || !user || !pass) {
    const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter(
      (k) => !process.env[k]?.trim(),
    );
    throw new Error(
      `DATABASE_URL is not set, and the Hostinger MySQL path is incomplete.\n` +
        `Set DATABASE_URL, or set all of: ${missing.join(", ")}`,
    );
  }

  // The panel lists the port as its own field, but pasting
  // "mysqlXX.hostinger.com:3306" into DB_HOST is natural. Appending our own
  // ":3306" on top of that yields host:3306:3306, which Prisma rejects with
  // "invalid port number" — so take the port from DB_HOST when it is there.
  const withPort = /^(.+):(\d{1,5})$/.exec(host);
  const hostname = withPort?.[1] ?? host;
  const port = withPort?.[2] ?? "3306";

  // Special characters must be percent-encoded anywhere in the URL, the
  // password most of all: a '#', '/' or '?' in DB_PASSWORD ends the URL at
  // parse time, and that failure surfaces as the same misleading
  // "invalid port number". (Prisma docs → Connection URLs → special characters.)
  const url =
    `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}` +
    `@${hostname}:${port}/${encodeURIComponent(name)}`;

  assertParseable(
    url,
    `DB_HOST ("${hostname}") is not a hostname Prisma can parse. ` +
      `Set it to the MySQL host alone, e.g. mysqlXX.hostinger.com, with or without :port.`,
  );
  return url;
}

/* Assemble the URL before any Prisma client is constructed. */
const suppliedUrl = process.env.DATABASE_URL?.trim();

if (suppliedUrl) {
  assertParseable(
    suppliedUrl,
    `DATABASE_URL is not a valid URL. If its password contains # / ? % @ : or spaces, ` +
      `percent-encode them (each character becomes %xx), or unset it and use ` +
      `DB_HOST, DB_NAME, DB_USER and DB_PASSWORD instead.`,
  );
}

const resolvedUrl = suppliedUrl || buildHostingerUrl();

process.env.DATABASE_URL = resolvedUrl;

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
