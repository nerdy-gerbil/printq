/**
 * Reading the live schema back out of INFORMATION_SCHEMA.
 *
 * The first version of this compared `NON_UNIQUE` to the number `0`. On this
 * MariaDB (11.8) `INFORMATION_SCHEMA.STATISTICS.NON_UNIQUE` is declared
 * `bigint(1)`, and Prisma's `$queryRaw` hands a BIGINT back as a `BigInt` — so
 * `row.NON_UNIQUE === 0` was false for every row, every index was recorded as
 * non-unique, every unique index was judged missing, and `CREATE UNIQUE INDEX`
 * ran on an index that already existed:
 *
 *     Raw query failed. Code: `1061`. Message: `Duplicate key name 'user_email_key'`
 *
 * Hence the coercion below — accept whatever numeric type arrives — and hence
 * keeping this logic pure and separate from the database, so
 * `scripts/verify-ddl.ts` can pin it with a BigInt row instead of everyone
 * discovering it one failed deploy at a time.
 */

/** One row of `INFORMATION_SCHEMA.STATISTICS`, as Prisma hands it over. */
export type StatisticRow = {
  INDEX_NAME: string;
  COLUMN_NAME: string;
  /** 0 for a unique index, 1 otherwise — `number`, `bigint` or `string`. */
  NON_UNIQUE: number | bigint | string;
};

/** One index, its columns in index order, and whether it is unique. */
export type IndexShape = {
  name: string;
  columns: string[];
  unique: boolean;
};

/**
 * `NON_UNIQUE` means `unique` when it is zero, whatever type it arrives in:
 * a plain number, a BigInt (BIGINT columns), or the string a driver may format
 * it into.
 */
export function isUniqueRow(row: StatisticRow): boolean {
  return Number(row.NON_UNIQUE) === 0;
}

/**
 * Collapse per-column STATISTICS rows into one shape per index. Callers should
 * order by `SEQ_IN_INDEX` so `columns` keeps the index's real order.
 */
export function indexesFromStatisticRows(rows: StatisticRow[]): IndexShape[] {
  const byName = new Map<string, IndexShape>();
  for (const row of rows) {
    const entry =
      byName.get(row.INDEX_NAME) ??
      { name: row.INDEX_NAME, columns: [], unique: isUniqueRow(row) };
    entry.columns.push(row.COLUMN_NAME);
    byName.set(row.INDEX_NAME, entry);
  }
  return [...byName.values()];
}

/**
 * Is there already an index on exactly these columns with this uniqueness?
 * Column order is not compared: MySQL can satisfy a request with either order,
 * and the reconciliation only ever asks for a set of columns.
 */
export function indexPresent(
  indexes: IndexShape[],
  columns: string[],
  unique: boolean,
): boolean {
  return indexes.some(
    (ix) =>
      ix.unique === unique &&
      ix.columns.length === columns.length &&
      ix.columns.every((c) => columns.includes(c)),
  );
}
