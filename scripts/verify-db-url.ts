/**
 * Verify the DATABASE_URL assembly in src/lib/db.ts and scripts/_env.ts.
 *
 * Prisma reports any malformed connection string as `invalid port number in
 * database URL`, which names no variable and often is not about the port:
 * a doubled port (DB_HOST pasted with :3306) and a '#', '/' or '?' in the
 * password all produce it. This check runs the real assembly in child
 * processes with those shapes, asserts on the URL that comes out, and — for
 * the assembled URLs — asks Prisma itself to parse it, so "accepted" means
 * the query engine got past the URL rather than that we think it should.
 *
 * Usage: npx tsx scripts/verify-db-url.ts  (exits 1 on any failure)
 */
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

type Result = { url?: string; throw?: string; parse?: string };

const CASES: {
  name: string;
  mode: "db" | "env" | "control";
  env: Record<string, string>;
  check: (r: Result) => string | null; // null = pass, otherwise the reason
}[] = [
  {
    name: "four vars, plain host → URL assembled and Prisma parses it",
    mode: "db",
    env: {
      DB_HOST: "127.0.0.1",
      DB_NAME: "u678003261_printq",
      DB_USER: "u678003261_printq",
      DB_PASSWORD: "plainpass123",
    },
    check: (r) =>
      r.url === "mysql://u678003261_printq:plainpass123@127.0.0.1:3306/u678003261_printq"
        ? r.parse?.startsWith("ACCEPTED")
          ? null
          : `parse=${r.parse}`
        : `url=${r.url} throw=${r.throw}`,
  },
  {
    name: "DB_HOST already carries :port → not doubled to host:port:3306",
    mode: "db",
    env: { DB_HOST: "127.0.0.1:13306", DB_NAME: "db", DB_USER: "u", DB_PASSWORD: "p" },
    check: (r) =>
      r.url === "mysql://u:p@127.0.0.1:13306/db"
        ? r.parse?.startsWith("ACCEPTED")
          ? null
          : `parse=${r.parse}`
        : `url=${r.url} throw=${r.throw}`,
  },
  {
    name: "password with # / ? @ : % and a space → percent-encoded, Prisma parses it",
    mode: "db",
    env: {
      DB_HOST: "127.0.0.1",
      DB_NAME: "db",
      DB_USER: "u",
      DB_PASSWORD: "p#ss/w?rd:x@y %z",
    },
    check: (r) => {
      const want =
        "mysql://u:" +
        encodeURIComponent("p#ss/w?rd:x@y %z") +
        "@127.0.0.1:3306/db";
      return r.url === want
        ? r.parse?.startsWith("ACCEPTED")
          ? null
          : `parse=${r.parse}`
        : `url=${r.url} throw=${r.throw}`;
    },
  },
  {
    name: "supplied DATABASE_URL with # in password → boot error naming DATABASE_URL",
    mode: "db",
    env: { DATABASE_URL: "mysql://u:p#x@127.0.0.1:3306/db" },
    check: (r) =>
      r.throw?.includes("DATABASE_URL is not a valid URL")
        ? null
        : `throw=${r.throw} url=${r.url}`,
  },
  {
    name: "supplied DATABASE_URL, well-formed → passed through untouched",
    mode: "db",
    env: { DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db" },
    check: (r) =>
      r.url === "mysql://u:p@127.0.0.1:3306/db" && r.parse?.startsWith("ACCEPTED")
        ? null
        : `url=${r.url} throw=${r.throw} parse=${r.parse}`,
  },
  {
    name: "nothing set → error lists all four DB_* variables",
    mode: "db",
    env: {},
    check: (r) =>
      r.throw?.includes("DB_HOST, DB_NAME, DB_USER, DB_PASSWORD")
        ? null
        : `throw=${r.throw}`,
  },
  {
    name: "_env.ts assembles the same encoded URL",
    mode: "env",
    env: { DB_HOST: "127.0.0.1", DB_NAME: "db", DB_USER: "u", DB_PASSWORD: "p#s" },
    check: (r) =>
      r.url === "mysql://u:p%23s@127.0.0.1:3306/db" ? null : `url=${r.url} throw=${r.throw}`,
  },
  {
    name: "control: Prisma really rejects an unencoded # (so ACCEPTED means something)",
    mode: "control",
    env: { DATABASE_URL: "mysql://u:p#x@127.0.0.1:3306/db" },
    check: (r) => (r.parse?.startsWith("REJECTED") ? null : `parse=${r.parse}`),
  },
];

function runCase(mode: string, env: Record<string, string>): Result {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.DATABASE_URL;
  delete childEnv.DB_HOST;
  delete childEnv.DB_NAME;
  delete childEnv.DB_USER;
  delete childEnv.DB_PASSWORD;
  Object.assign(childEnv, env);

  const options: SpawnSyncOptionsWithStringEncoding = {
    shell: true,
    env: childEnv,
    encoding: "utf8",
    timeout: 30_000,
  };
  const res = spawnSync(`npx tsx "${process.argv[1]}" --case ${mode}`, options);
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const pick = (label: string) =>
    out.split(/\r?\n/).find((l) => l.startsWith(`${label}=`))?.slice(label.length + 1);
  return { url: pick("URL"), throw: pick("THROW"), parse: pick("PARSE") };
}

// ---- child mode: run the real code, report what it produced -----------------

if (process.argv[2] === "--case") {
  const mode = process.argv[3];
  const say = (label: string, value: string) => console.log(`${label}=${value}`);

  try {
    if (mode === "env") {
      const mod = await import("./_env");
      say("URL", mod.DATABASE_URL);
    } else if (mode === "db") {
      await import("../src/lib/db");
      say("URL", process.env.DATABASE_URL ?? "");
    }
  } catch (e) {
    say("THROW", String((e as Error).message).replace(/\r?\n/g, " | "));
    process.exit(0);
  }

  if (mode === "db" || mode === "control") {
    // Ask Prisma to parse: a URL failure says so explicitly; anything else
    // (localhost refuses the connection) means the URL itself was accepted.
    try {
      const { PrismaClient } = await import("@prisma/client");
      await new PrismaClient().$queryRaw`SELECT 1`;
      say("PARSE", "ACCEPTED");
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const rejected =
        msg.includes("Error parsing connection string") ||
        msg.includes("invalid port number");
      say("PARSE", `${rejected ? "REJECTED" : "ACCEPTED"}: ${msg.slice(0, 70)}`);
    }
  }
  process.exit(0);
}

// ---- parent mode: run every case and report --------------------------------

let failed = 0;
for (const c of CASES) {
  const result = runCase(c.mode, c.env);
  const reason = c.check(result);
  if (reason) {
    failed++;
    console.log(`FAIL  ${c.name}\n      ${reason}`);
  } else {
    console.log(`ok    ${c.name}`);
  }
}
console.log(failed === 0 ? `\nAll ${CASES.length} cases passed.` : `\n${failed} case(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
