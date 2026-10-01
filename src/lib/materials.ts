import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import type { Actor } from "@/lib/scope";

/**
 * The materials catalogue — what a request can be made from, owner-managed
 * rather than a compile-time enum.
 *
 * Mirrors `benefits.ts` exactly: reads open, mutations admin-only and
 * re-checked here, every change audited. `Story.material` is a plain string,
 * so renaming or retiring a material never rewrites a past ticket — it just
 * drops off the upload form's choices.
 *
 * A material and its $/kg price are one fact, so the rate lives beside it on
 * the admin screen (two pages that could say different things about the same
 * material is how drift starts). The rate row itself is keyed by name, not
 * foreign-keyed: a rate for a since-renamed material keeps working.
 */

export class MaterialProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialProblem";
  }
}

const NameSchema = z
  .string()
  .trim()
  .min(1, "Give the material a name.")
  .max(40, "Keep it short — under 40 characters.");

const RateSchema = z.coerce
  .number()
  .min(0, "A price cannot be negative.")
  .max(10_000, "That price looks like a typo.");

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw new MaterialProblem("Only an admin manages materials.");
  }
}

function refresh() {
  revalidatePath("/admin/materials");
  revalidatePath("/admin/rates");
  revalidatePath("/upload");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type MaterialRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  /** $/kg, or null when no rate has been set yet. */
  dollarsPerKg: number | null;
};

const ORDER = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

/** The choices the upload form offers, with their prices for display. */
export function listActiveMaterials(): Promise<MaterialRow[]> {
  return db.material.findMany({
    where: { active: true },
    select: { id: true, name: true, active: true, sortOrder: true },
    orderBy: ORDER,
  }).then(async (rows) => {
    const rates = await db.materialRate.findMany();
    const byMaterial = new Map(rates.map((r) => [r.material, r.dollarsPerKg]));
    return rows.map((r) => ({ ...r, dollarsPerKg: byMaterial.get(r.name) ?? null }));
  });
}

/** Everything, for the admin screen — retired materials included. */
export function listAllMaterials(): Promise<MaterialRow[]> {
  return db.material.findMany({
    select: { id: true, name: true, active: true, sortOrder: true },
    orderBy: ORDER,
  }).then(async (rows) => {
    const rates = await db.materialRate.findMany();
    const byMaterial = new Map(rates.map((r) => [r.material, r.dollarsPerKg]));
    return rows.map((r) => ({ ...r, dollarsPerKg: byMaterial.get(r.name) ?? null }));
  });
}

/** The names an upload's material is allowed to be. Authoritative on the server. */
export async function activeMaterialNames(): Promise<string[]> {
  const rows = await db.material.findMany({ where: { active: true }, select: { name: true } });
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Mutations (admin-only)
// ---------------------------------------------------------------------------

export async function createMaterial(actor: Actor, rawName: unknown): Promise<MaterialRow> {
  assertAdmin(actor);

  const parsed = NameSchema.safeParse(typeof rawName === "string" ? rawName : "");
  if (!parsed.success) throw new MaterialProblem(parsed.error.issues[0]?.message ?? "Check the name.");
  const name = parsed.data;

  const last = await db.material.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });

  let created;
  try {
    created = await db.material.create({
      data: { name, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
  } catch {
    throw new MaterialProblem(`“${name}” is already on the list.`);
  }

  await record({ action: "material.created", actor, subject: name });
  refresh();
  return { ...created, dollarsPerKg: null };
}

export async function renameMaterial(actor: Actor, id: string, rawName: unknown): Promise<MaterialRow> {
  assertAdmin(actor);

  const parsed = NameSchema.safeParse(typeof rawName === "string" ? rawName : "");
  if (!parsed.success) throw new MaterialProblem(parsed.error.issues[0]?.message ?? "Check the name.");

  const existing = await db.material.findUnique({ where: { id } });
  if (!existing) throw new MaterialProblem("That material no longer exists.");
  if (existing.name === parsed.data) return { ...existing, dollarsPerKg: null };

  try {
    const updated = await db.material.update({ where: { id }, data: { name: parsed.data } });
    await record({
      action: "material.updated",
      actor,
      subject: updated.name,
      detail: { renamedFrom: existing.name },
    });
    refresh();
    return { ...updated, dollarsPerKg: null };
  } catch {
    throw new MaterialProblem(`“${parsed.data}” is already on the list.`);
  }
}

/** Retire (or restore). Retirement keeps past tickets reading correctly. */
export async function setMaterialActive(actor: Actor, id: string, active: boolean): Promise<void> {
  assertAdmin(actor);

  const existing = await db.material.findUnique({ where: { id } });
  if (!existing) throw new MaterialProblem("That material no longer exists.");
  if (existing.active === active) return;

  await db.material.update({ where: { id }, data: { active } });
  await record({
    action: active ? "material.restored" : "material.retired",
    actor,
    subject: existing.name,
  });
  refresh();
}

/** Set (or change) the $/kg price for a material. */
export async function setMaterialRate(actor: Actor, name: string, rawDollars: unknown): Promise<void> {
  assertAdmin(actor);

  const parsed = RateSchema.safeParse(typeof rawDollars === "string" || typeof rawDollars === "number" ? rawDollars : "");
  if (!parsed.success) throw new MaterialProblem(parsed.error.issues[0]?.message ?? "Check the price.");

  const exists = await db.material.findUnique({ where: { name }, select: { name: true } });
  if (!exists) throw new MaterialProblem("That material no longer exists.");

  const before = await db.materialRate.findUnique({ where: { material: name } });
  await db.materialRate.upsert({
    where: { material: name },
    update: { dollarsPerKg: parsed.data },
    create: { material: name, dollarsPerKg: parsed.data },
  });

  await record({
    action: "material.rate_changed",
    actor,
    subject: name,
    detail: { from: before?.dollarsPerKg ?? null, to: parsed.data },
  });
  refresh();
}
