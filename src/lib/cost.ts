import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
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
  total: number;
  /** The rates used, so the UI can show its working. */
  dollarsPerKg: number;
  dollarsPerHour: number;
};

/** Rates with fallbacks, so a ticket never renders "null dollars". */
export async function currentRates(material: string): Promise<{
  dollarsPerKg: number;
  dollarsPerHour: number;
}> {
  const [rate, machine] = await Promise.all([
    db.materialRate.findUnique({ where: { material } }),
    db.machineRate.findUnique({ where: { id: "default" } }),
  ]);
  return {
    dollarsPerKg: rate?.dollarsPerKg ?? 0,
    dollarsPerHour: machine?.dollarsPerHour ?? 0,
  };
}

/**
 * The derived cost for a ticket. Null while either measurement is missing —
 * half a cost is a guess wearing half a costume.
 */
export function deriveCost(
  input: CostInput,
  rates: { dollarsPerKg: number; dollarsPerHour: number },
): Cost | null {
  if (input.weightGrams == null || input.printMinutes == null) return null;
  if (input.weightGrams < 0 || input.printMinutes < 0) return null;

  const filament = (input.weightGrams / 1000) * rates.dollarsPerKg;
  const machine = (input.printMinutes / 60) * rates.dollarsPerHour;
  const total = Math.round((filament + machine) * 100) / 100;

  return {
    filament: Math.round(filament * 100) / 100,
    machine: Math.round(machine * 100) / 100,
    total,
    dollarsPerKg: rates.dollarsPerKg,
    dollarsPerHour: rates.dollarsPerHour,
  };
}

/** Convenience wrapper the pages use: rates fetched, cost derived. */
export async function costFor(input: CostInput): Promise<Cost | null> {
  const rates = await currentRates(input.material);
  return deriveCost(input, rates);
}

/** "$4.32" — two decimals, no trailing-zero games. */
export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

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

  revalidatePath("/admin/rates");
  revalidatePath("/admin/materials");
  revalidatePath("/queue");
}

/** "3 h 25 m" / "48 m" — minutes as a person reads them. */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} m`;
}
