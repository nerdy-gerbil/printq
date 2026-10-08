/**
 * The MySQL DDL the Hostinger reconciliation issues, in one place.
 *
 * Every clause is joined with exactly one space, and every statement is run
 * through `assertNoGluedKeyword` before it is handed back. That is not style:
 * the version that interpolated clauses straight into a template string
 * (`${type}${nullable}`) emitted `TEXTNOT NULL`, which MySQL rejects with
 * `Unknown data type: 'TEXTNOT'` — the error that failed the Hostinger build,
 * and one no amount of reading the source made obvious, because the missing
 * character is a space at a line-wrap boundary.
 *
 * Keeping the assembly here has a second purpose: it is pure, so
 * `scripts/verify-ddl.ts` can assert the exact statements without a database,
 * which is the only way to check this step on a machine that cannot reach the
 * Hostinger MySQL.
 */

/** One column, as the reconciliation knows it. */
export type ColumnSpec = {
  /** Column name, unquoted. */
  name: string;
  /** MySQL type: TEXT, INTEGER, BIGINT, BOOLEAN, DATETIME, JSON, DOUBLE PRECISION. */
  type: string;
  /** true → NOT NULL. */
  required: boolean;
  /**
   * Raw default expression, already quoted for literals (`'user'`, `false`,
   * `CURRENT_TIMESTAMP`), or null/undefined for no DEFAULT clause at all.
   */
  default?: string | null;
};

/** The types this script emits. Kept in one list so the guard can see them. */
export const MYSQL_TYPES = [
  "DOUBLE PRECISION",
  "TEXT",
  "INTEGER",
  "BIGINT",
  "BOOLEAN",
  "DATETIME",
  "JSON",
] as const;

/**
 * A type with a keyword glued to it — `TEXTNOT NULL`, `INTEGERDEFAULT 0`.
 * The lookahead is what makes this precise: `TEXT NOT NULL` has a space after
 * the type, so it does not match; `TEXTNOT NULL` does.
 */
const GLUED_TYPE_KEYWORD = new RegExp(
  `(?:${MYSQL_TYPES.join("|")})(?=NOT\\b|NULL\\b|DEFAULT\\b|PRIMARY\\b|UNIQUE\\b)`,
);

/** A template that glues two interpolations together, e.g. `${type}${nullable}`. */
const GLUED_TEMPLATES = new RegExp("\\$\\{[^}]+\\}\\$\\{");

/**
 * Throw if `statement` contains the glued shape this module exists to prevent.
 * Exported so scripts/verify-ddl.ts can prove the guard catches the old bug
 * rather than only that it stays quiet on the new code.
 */
export function assertNoGluedKeyword(statement: string): void {
  const glued = GLUED_TYPE_KEYWORD.exec(statement);
  if (glued !== null) {
    throw new Error(
      `refusing to run malformed DDL (missing space before "${glued[0]}"): ${statement}`,
    );
  }
  const template = GLUED_TEMPLATES.exec(statement);
  if (template !== null) {
    throw new Error(
      `refusing to run malformed DDL (two interpolations glued together): ${statement}`,
    );
  }
}

const quote = (name: string): string => `\`${name}\``;

/** `` `tip` TEXT NOT NULL DEFAULT 'x' `` — one column's definition. */
export function columnDefinition(column: ColumnSpec): string {
  const clauses = [quote(column.name), column.type];
  if (column.required) clauses.push("NOT NULL");
  if (column.default !== null && column.default !== undefined) {
    clauses.push(`DEFAULT ${column.default}`);
  }
  return clauses.join(" ");
}

export function createTableSql(table: string, columns: ColumnSpec[]): string {
  const body = columns.map((column) => `  ${columnDefinition(column)}`).join(",\n");
  const statement = `CREATE TABLE ${quote(table)} (\n${body}\n);`;
  assertNoGluedKeyword(statement);
  return statement;
}

export function addColumnSql(table: string, column: ColumnSpec): string {
  const statement = `ALTER TABLE ${quote(table)} ADD COLUMN ${columnDefinition(column)};`;
  assertNoGluedKeyword(statement);
  return statement;
}

/**
 * MODIFY replaces a column's whole definition, so anything the column needs
 * (type, nullability, default) has to be in `column` — including on the way in.
 */
export function modifyColumnSql(table: string, column: ColumnSpec): string {
  const statement = `ALTER TABLE ${quote(table)} MODIFY ${columnDefinition(column)};`;
  assertNoGluedKeyword(statement);
  return statement;
}

export function createIndexSql(
  table: string,
  columns: string[],
  unique: boolean,
  name: string,
): string {
  const statement =
    `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quote(name)} ON ${quote(table)} ` +
    `(${columns.map(quote).join(", ")});`;
  assertNoGluedKeyword(statement);
  return statement;
}
