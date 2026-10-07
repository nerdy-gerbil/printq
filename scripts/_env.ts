// DATABASE_URL may be supplied directly (compose/docker path). When it is not,
// the Hostinger Business MySQL path supplies the four parts and we assemble the URL.

function buildHostingerUrl() {
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

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
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
