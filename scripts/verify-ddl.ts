/**
 * Verify the MySQL DDL the Hostinger reconciliation generates.
 *
 * The build that failed on Hostinger did so with a single line of MySQL's
 * opinion — `Unknown data type: 'TEXTNOT'` — because a column definition was
 * assembled as `${type}${nullable}` with no space between the type and
 * `NOT NULL`. Nothing in the repository could have caught that: the SQL never
 * exists as source, and the only machine that sees it is the build that dies.
 *
 * This check closes that gap. scripts/lib/ddl.ts is pure, so every statement
 * this suite asserts on is built here, in-process, with no database, no
 * credentials and no Hostinger account. It pins the exact statements for the
 * cases that broke, sweeps the type/nullability/default matrix against an
 * independently built expectation, and proves the guard actually rejects the
 * old glued form rather than merely staying quiet on the new one.
 *
 * Usage: npx tsx scripts/verify-ddl.ts  (exits 1 on any failure)
 */
import { readFileSync } from "node:fs";

import {
  MYSQL_TYPES,
  addColumnSql,
  assertNoGluedKeyword,
  createIndexSql,
  createTableSql,
  columnDefinition,
  modifyColumnSql,
} from "./lib/ddl";

/** null = pass, otherwise why it failed. */
type Case = { name: string; check: () => string | null };

const CASES: Case[] = [
  {
    // The exact statement shape that failed the build. `ensureColumn("story",
    // "tip", "TEXT", true)` used to emit `TEXTNOT NULL`.
    name: "required TEXT column → `TEXT NOT NULL`, not `TEXTNOT NULL`",
    check: () => {
      const sql = addColumnSql("story", { name: "tip", type: "TEXT", required: true });
      const want = "ALTER TABLE `story` ADD COLUMN `tip` TEXT NOT NULL;";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    name: "required DOUBLE PRECISION column keeps its two-word type and a space",
    check: () => {
      const sql = addColumnSql("material_rate", {
        name: "dollarsPerKg",
        type: "DOUBLE PRECISION",
        required: true,
      });
      const want = "ALTER TABLE `material_rate` ADD COLUMN `dollarsPerKg` DOUBLE PRECISION NOT NULL;";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    name: "optional column with a default → `TEXT DEFAULT 'user'`, in that order",
    check: () => {
      const sql = addColumnSql("user", {
        name: "role",
        type: "TEXT",
        required: false,
        default: "'user'",
      });
      const want = "ALTER TABLE `user` ADD COLUMN `role` TEXT DEFAULT 'user';";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    name: "default with no NOT NULL → three clauses, one space each",
    check: () => {
      const sql = addColumnSql("user", {
        name: "initials",
        type: "TEXT",
        required: true,
        default: "'??'",
      });
      const want = "ALTER TABLE `user` ADD COLUMN `initials` TEXT NOT NULL DEFAULT '??';";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    // The statement the previous two commits were aimed at, which was never
    // the failing one.
    name: "account.issuer → MODIFY ... TEXT NOT NULL",
    check: () => {
      const sql = modifyColumnSql("account", { name: "issuer", type: "TEXT", required: true });
      const want = "ALTER TABLE `account` MODIFY `issuer` TEXT NOT NULL;";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    name: "CREATE TABLE lays one column per line and stays well formed",
    check: () => {
      const sql = createTableSql("rateLimit", [
        { name: "id", type: "TEXT", required: true },
        { name: "key", type: "TEXT", required: true },
        { name: "count", type: "INTEGER", required: true },
        { name: "lastRequest", type: "BIGINT", required: true },
      ]);
      const want = [
        "CREATE TABLE `rateLimit` (",
        "  `id` TEXT NOT NULL,",
        "  `key` TEXT NOT NULL,",
        "  `count` INTEGER NOT NULL,",
        "  `lastRequest` BIGINT NOT NULL",
        ");",
      ].join("\n");
      return sql === want ? null : `got:\n${sql}`;
    },
  },
  {
    name: "composite unique index quotes every column, in order",
    check: () => {
      const sql = createIndexSql(
        "account",
        ["issuer", "accountId"],
        true,
        "account_issuer_accountId_key",
      );
      const want =
        "CREATE UNIQUE INDEX `account_issuer_accountId_key` ON `account` (`issuer`, `accountId`);";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    name: "non-unique index omits UNIQUE",
    check: () => {
      const sql = createIndexSql("notification", ["recipientId", "read"], false, "ix");
      const want = "CREATE INDEX `ix` ON `notification` (`recipientId`, `read`);";
      return sql === want ? null : `got: ${sql}`;
    },
  },
  {
    // The sweep: every type the script emits, against every combination of
    // nullability and default, compared to an expectation built here rather
    // than read back out of the builder.
    name: `every type x nullability x default is well formed (${MYSQL_TYPES.length} types)`,
    check: () => {
      const failures: string[] = [];
      const seen = new Set<string>();
      for (const type of MYSQL_TYPES) {
        for (const required of [true, false]) {
          for (const def of [null, "'x'", "CURRENT_TIMESTAMP", "false", "0"] as const) {
            const column = { name: "c", type, required, default: def };
            const got = columnDefinition(column);
            const want = [
              "`c`",
              type,
              required ? "NOT NULL" : null,
              def === null ? null : `DEFAULT ${def}`,
            ]
              .filter((part): part is string => part !== null)
              .join(" ");
            if (got !== want) failures.push(`${type}/${required}/${def}: got "${got}"`);
            if (/\s\s/.test(got)) failures.push(`${type}/${required}/${def}: double space in "${got}"`);
            seen.add(type);
          }
        }
      }
      const missing = MYSQL_TYPES.filter((t) => !seen.has(t));
      if (missing.length > 0) failures.push(`types never exercised: ${missing.join(", ")}`);
      return failures.length === 0 ? null : failures.join("; ");
    },
  },
  {
    // Control: without this, a guard that never fires would pass the suite.
    name: "control: the guard rejects the old glued forms",
    check: () => {
      const glued = [
        "ALTER TABLE `story` ADD COLUMN `tip` TEXTNOT NULL;",
        "ALTER TABLE `story` ADD COLUMN `qty` INTEGERDEFAULT 1;",
        "CREATE TABLE `t` (\n  `id` TEXTNOT NULL\n);",
        "ALTER TABLE `t` ADD COLUMN `x` ${type}${nullable};",
      ];
      const accepted = glued.filter((sql) => {
        try {
          assertNoGluedKeyword(sql);
          return true;
        } catch {
          return false;
        }
      });
      return accepted.length === 0 ? null : `guard accepted: ${accepted.join(" | ")}`;
    },
  },
  {
    name: "control: the guard accepts a correct statement",
    check: () => {
      try {
        assertNoGluedKeyword("ALTER TABLE `story` ADD COLUMN `tip` TEXT NOT NULL;");
        return null;
      } catch (error) {
        return `guard rejected a correct statement: ${(error as Error).message}`;
      }
    },
  },
  {
    // The regression pin on the real file, not on a copy of the pattern: the
    // bug was in the reconciliation script's own template strings.
    name: "reconcile-hostinger-db.ts builds its DDL in ./lib/ddl, not in its own templates",
    check: () => {
      const source = readFileSync(new URL("./reconcile-hostinger-db.ts", import.meta.url), "utf8");
      // The file may name the failure in prose — what must not come back is the
      // shape in code. Strip comments before looking.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/TEXTNOT/.test(code)) return "TEXTNOT is back in the code";
      if (!/from "\.\/lib\/ddl"/.test(source)) return "the script no longer imports ./lib/ddl";
      const raw = code.match(/\$executeRawUnsafe\(`/g) ?? [];
      return raw.length === 0 ? null : `${raw.length} DDL statement(s) still bypass the builder`;
    },
  },
];

let failed = 0;
for (const testCase of CASES) {
  let reason: string | null;
  try {
    reason = testCase.check();
  } catch (error) {
    reason = `threw: ${(error as Error).message}`;
  }
  if (reason) {
    failed++;
    console.log(`FAIL  ${testCase.name}\n      ${reason}`);
  } else {
    console.log(`ok    ${testCase.name}`);
  }
}
console.log(
  failed === 0 ? `\nAll ${CASES.length} cases passed.` : `\n${failed} case(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
