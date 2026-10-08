import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import type { Actor } from "@/lib/scope";

/**
 * The cost of a printed ticket, derived — never stored, never estimated.
 *
 * The inputs are two numbers the print team records once the print is real:
 * filament weighed in grams, and wall-clock minutes. Nothing infers either at
 * upload time, for the same rule that dropped the print-time estimate: a
 * number nobody measured is not shown. The rates are owner-managed data
 * (`MaterialRate` per $/kg, one shared `MachineRate` per $/hour).
 *
 * Cost is computed at render from the CURRENT rates, not snapshotted: a past
 * ticket does not pretend today's filament price is what it cost. If the shop
 * ever needs historical cost, the rate belongs on the Story at completion —
 * a deliberate schema change, not a quiet one.
 */

export type CostInput = {
  material: string;
  weightGrams: number | null;
  printMinutes: number | null;
};

export type Cost = {
  filament: number;
  machine: number;
  /** Filament + machine: what the print cost the shop. */
  total: number;
  /** The markup those two attracted, in the shop's currency. 0 when unset. */
  markup: number;
  /**
   * What to charge: the cost plus markup, floored at the minimum charge.
   * Identical to `total` while both settings are 0, which is the default — a
   * shop that never opens the settings screen sees exactly what it saw before.
   */
  price: number;
  /** true when the floor is what set the price, so the screen can say so. */
  minimumApplied: boolean;
  /** The rates used, so the UI can show its working. */
  dollarsPerKg: number;
  dollarsPerHour: number;
};

/**
 * Everything a cost derives from: the two rates, plus the shop's markup and
 * floor. The rates live in the database (owner-managed), the other two are
 * settings — but a caller that has to fetch both to price one ticket would
 * forget one, so `currentRates` returns all four.
 */
export type RateCard = {
  dollarsPerKg: number;
  dollarsPerHour: number;
  markupPercent: number;
  minimumCharge: number;
};

/** Rates with fallbacks, so a ticket never renders "null dollars". */
export async function currentRates(material: string): Promise<RateCard> {
  const [rate, machine, settings] = await Promise.all([
    db.materialRate.findUnique({ where: { material } }),
    db.machineRate.findUnique({ where: { id: "default" } }),
    getSettings(),
  ]);
  return {
    dollarsPerKg: rate?.dollarsPerKg ?? 0,
    dollarsPerHour: machine?.dollarsPerHour ?? 0,
    markupPercent: settings.markupPercent,
    minimumCharge: settings.minimumCharge,
  };
}

/**
 * The derived cost for a ticket. Null while either measurement is missing —
 * half a cost is a guess wearing half a costume.
 *
 * Two numbers come out of it, and the difference between them is the point.
 * `total` is what the print cost — filament weighed and minutes on the bed,
 * at today's rates. `price` is what the shop asks for it: the cost plus the
 * owner's markup, floored at their minimum charge. Most shops that charge at
 * all charge something above cost, and a screen that only knows the cost
 * leaves that arithmetic to whoever is telling the customer a number.
 *
 * Both come out of the same rates, so they cannot drift apart, and with the
 * markup and floor left at 0 — the defaults — `price` and `total` are the same
 * figure to the penny.
 *
 * `markupPercent` and `minimumCharge` are optional so a caller with only the
 * two rates (a test, a pure calculation) is not forced to invent them.
 */
export function deriveCost(input: CostInput, rates: RateCard): Cost | null {
  if (input.weightGrams == null || input.printMinutes == null) return null;
  if (input.weightGrams < 0 || input.printMinutes < 0) return null;

  const round = (n: number) => Math.round(n * 100) / 100;

  const filament = (input.weightGrams / 1000) * rates.dollarsPerKg;
  const machine = (input.printMinutes / 60) * rates.dollarsPerHour;
  const subtotal = filament + machine;

  const markupPercent = rates.markupPercent ?? 0;
  const minimumCharge = rates.minimumCharge ?? 0;

  const markup = subtotal * (markupPercent / 100);
  const marked = subtotal + markup;
  const minimumApplied = minimumCharge > 0 && marked < minimumCharge;
  const price = minimumApplied ? minimumCharge : marked;

  return {
    filament: round(filament),
    machine: round(machine),
    total: round(subtotal),
    markup: round(markup),
    price: round(price),
    minimumApplied,
    dollarsPerKg: rates.dollarsPerKg,
    dollarsPerHour: rates.dollarsPerHour,
  };
}

/** Convenience wrapper the pages use: rates fetched, cost derived. */
export async function costFor(input: CostInput): Promise<Cost | null> {
  const rates = await currentRates(input.material);
  return deriveCost(input, rates);
}

// Money is formatted in `./money.ts`, which has no `server-only` so the
// ledger form (a client-side component) can read the same currency the page
// renders in. It used to live here, and the five places that also wrote a bare
// `$` are why a shop in euro still had dollar signs on its prices.

// ---------------------------------------------------------------------------
// The machine rate — one $/hour figure for the shop, owner-managed
// ---------------------------------------------------------------------------

export class CostProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostProblem";
  }
}

const MachineRateSchema = z.coerce
  .number()
  .min(0, "A rate cannot be negative.")
  .max(10_000, "That rate looks like a typo.");

/**
 * Set the shop's single machine rate ($/hour). Admin-only and audited, like
 * every mutation of owner-managed data. One row, id "default": there is one
 * machine by the window, and pretending otherwise would be a schema looking
 * for a fleet it does not have.
 */
export async function setMachineRate(actor: Actor, rawDollars: unknown): Promise<void> {
  if (actor.role !== "admin") {
    throw new CostProblem("Only an admin sets the machine rate.");
  }

  const parsed = MachineRateSchema.safeParse(
    typeof rawDollars === "string" || typeof rawDollars === "number" ? rawDollars : "",
  );
  if (!parsed.success) throw new CostProblem(parsed.error.issues[0]?.message ?? "Check the rate.");

  const before = await db.machineRate.findUnique({ where: { id: "default" } });
  await db.machineRate.upsert({
    where: { id: "default" },
    update: { dollarsPerHour: parsed.data },
    create: { id: "default", dollarsPerHour: parsed.data },
  });

  await record({
    action: "machine.rate_changed",
    actor,
    subject: "machine hour",
    detail: { from: before?.dollarsPerHour ?? null, to: parsed.data },
  });

  revalidatePath("/admin/settings/rates");
  revalidatePath("/admin/settings/materials");
  revalidatePath("/queue");
}

/** "3 h 25 m" / "48 m" — minutes as a person reads them. */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} m`;
}
