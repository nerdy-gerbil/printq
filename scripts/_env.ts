// DATABASE_URL may be supplied directly (compose/docker path). When it is not,
// the Hostinger Business MySQL path supplies the four parts and we assemble the URL.
// The assembly mirrors src/lib/db.ts: percent-encoded credentials and a port
// that may already be part of DB_HOST, so Prisma never sees a URL it would
// reject as "invalid port number".

/** Complain about a malformed URL ourselves — Prisma would only say
 * "invalid port number", pointing at no variable in particular. */
function assertParseable(url: string, complaint: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(
      `${complaint}\nThe URL in question: ${url.replace(/\/\/[^@]*@/, "//***@")}`,
    );
  }
}

function buildHostingerUrl() {
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
  const withPort = /^(.+):(\d{1,5})$/.exec(host);
  const hostname = withPort?.[1] ?? host;
  const port = withPort?.[2] ?? "3306";
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

function resolveDatabaseUrl() {
  const supplied = process.env.DATABASE_URL?.trim();
  if (supplied) {
    assertParseable(
      supplied,
      `DATABASE_URL is not a valid URL. If its password contains # / ? % @ : or spaces, ` +
        `percent-encode them (each character becomes %xx), or unset it and use ` +
        `DB_HOST, DB_NAME, DB_USER and DB_PASSWORD instead.`,
    );
    return supplied;
  }
  return buildHostingerUrl();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    const missing = [name];
    throw new Error(
      `Environment variable not found: ${name}\n` +
        `Set ${name} in your .env file or environment before running this script.`,
    );
  }
  return value;
}

export const DATABASE_URL = resolveDatabaseUrl();
