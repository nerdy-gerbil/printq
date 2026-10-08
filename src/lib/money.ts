/**
 * Money, printed the way the shop's own currency prints it.
 *
 * Its own module, with no `server-only` and no database, because both sides
 * need it: a server component renders a ticket's total, and the ledger form in
 * the print team's panel says what its numbers will be multiplied by. A module
 * that imported `db` here would drag the whole Prisma client into the browser
 * bundle — the same reason `upload-limits.ts` exists.
 *
 * The currency itself is an owner-managed setting (`src/lib/settings.ts`), so
 * every function here takes one. There is deliberately no default that the
 * call sites can forget: the code used to read `$${n.toFixed(2)}` in one place
 * and `$/kg` in four others, which meant a shop in euro had a dollar sign on
 * its prices and no single line to change.
 *
 * `Intl` rather than a symbol table: it knows that yen has no minor unit, that
 * the euro goes after the number in some locales, and it is what decides where
 * the symbol sits. The locale is pinned to "en" (dollars first, then the
 * amount) on purpose — the app's copy is English, and a locale that moved the
 * symbol would disagree with the labels around it.
 */

/** The currencies the settings screen offers, in the order it offers them. */
export const CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound sterling" },
  { code: "CHF", name: "Swiss franc" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "PLN", name: "Polish złoty" },
  { code: "CZK", name: "Czech koruna" },
  { code: "HUF", name: "Hungarian forint" },
  { code: "RON", name: "Romanian leu" },
  { code: "TRY", name: "Turkish lira" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "INR", name: "Indian rupee" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "AED", name: "UAE dirham" },
  { code: "ILS", name: "Israeli new shekel" },
  { code: "ZAR", name: "South African rand" },
  { code: "BRL", name: "Brazilian real" },
  { code: "MXN", name: "Mexican peso" },
] as const;

export type Currency = (typeof CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: Currency = "USD";

const CODES: readonly string[] = CURRENCIES.map((c) => c.code);

export function isCurrency(code: string): code is Currency {
  return CODES.includes(code);
}

/**
 * One formatter per currency, kept: building an `Intl.NumberFormat` is not
 * free, and a queue page formats a price per row.
 */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A formatter for `currency`, or the default's when handed something that is
 * not on the list. Falling back rather than throwing is deliberate: a currency
 * in the database that this build has never heard of must not be able to take
 * a page down, and the fallback is visible in the output.
 */
function formatterFor(currency: string): Intl.NumberFormat {
  const code = isCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const existing = formatters.get(code);
  if (existing) return existing;

  const built = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    // "€1.00" rather than "EUR 1.00" — the symbol is what people read.
    currencyDisplay: "narrowSymbol",
  });
  formatters.set(code, built);
  return built;
}

/** "€1.20" / "$4.32" / "¥120" — the currency's own number of decimals. */
export function formatMoney(amount: number, currency: string): string {
  return formatterFor(currency).format(amount);
}

/** "$" / "€" / "CHF" — for copy that names the unit without a number. */
export function currencySymbol(currency: string): string {
  const parts = formatterFor(currency).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

/** "$3.00 / kg" — a rate, which is an amount and a unit it applies to. */
export function formatRate(amount: number, currency: string, unit: string): string {
  return `${formatMoney(amount, currency)} / ${unit}`;
}
