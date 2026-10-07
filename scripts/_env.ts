// DATABASE_URL is a URL, not a problem-specific variable.
// The only secret that lives separately is DB_PASSWORD, and that exists because
// docker-compose.prod.yml interpolates it into a URL rather than because the app
// needs it whole. HOST_DB_NAME is the one new variable worth adding, and only so
// a Hostinger Business MySQL database — which Hostinger names `{account}_{name}`, not
// plain `printq` — can be pointed at without putting that long name into a URL.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable not found: ${name}\n` +
        `Set ${name} in your .env file or environment before running this script.`,
    );
  }
  return value;
}

export const DATABASE_URL = requireEnv("DATABASE_URL");
