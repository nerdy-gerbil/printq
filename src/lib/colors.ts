import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import type { Actor } from "@/lib/scope";
import { COLORS } from "@/lib/catalog";

/**
 * The colours a material is offered in — what the upload form puts in front of
 * a requester, and what the Colours tab manages.
 *
 * Mirrors `materials.ts` and `benefits.ts`: reads open, mutations admin-only and
 * re-checked here, every change audited and every change revalidating the pages
 * that show it.
 *
 * Two rules are worth stating, because the rest of the app relies on them.
 *
 * A colour belongs to a material. A spool of PLA is not stocked in the colours
 * a bottle of resin is, so the pair (material, name) is the fact, and the upload
 * form only offers what the chosen material actually comes in. `material` is a
 * plain string rather than a foreign key, exactly like `MaterialRate.material`,
 * so a row for a since-renamed material keeps working.
 *
 * A material with nothing configured is not a material with no colours. It falls
 * back to the five swatches this app shipped with, so a fresh deployment — or a
 * material added a minute ago — behaves exactly as it did before any of this was
 * configurable, and an empty palette can never make uploading impossible.
 */

export class ColorProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColorProblem";
  }
}

export type ColorSwatch = { name: string; hex: string };

export type ColorRow = ColorSwatch & {
  id: string;
  material: string;
  active: boolean;
  sortOrder: number;
};

/**
 * The five swatches the app shipped with, still used twice: as the seed for a
 * fresh deploy, and as the fallback palette for a material nobody has configured
 * yet. Light ones need the inset ring on the form to stay visible.
 */
export const BUILT_IN_PALETTE: ColorSwatch[] = COLORS.map((c) => ({ name: c.name, hex: c.hex }));

const NameSchema = z
  .string()
  .trim()
  .min(1, "Give the colour a name.")
  .max(40, "Keep it short — under 40 characters.");

/** #rrggbb, lowercased on the way in so two spellings are one colour. */
const HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "A colour is a hex code like #4a5d78.");

const ORDER = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw new ColorProblem("Only an admin manages the colour list.");
  }
}

function refresh() {
  revalidatePath("/admin/settings/colors");
  revalidatePath("/upload");
}

function parse(rawName: unknown, rawHex: unknown): ColorSwatch {
  const name = NameSchema.safeParse(typeof rawName === "string" ? rawName : "");
  if (!name.success) throw new ColorProblem(name.error.issues[0]?.message ?? "Check the name.");

  const hex = HexSchema.safeParse(typeof rawHex === "string" ? rawHex : "");
  if (!hex.success) throw new ColorProblem(hex.error.issues[0]?.message ?? "Check the colour.");

  return { name: name.data, hex: hex.data };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The palette the upload form offers for one material — the form's own answer,
 * and the route's authority on what may be stored. Never empty: a material with
 * nothing on its list falls back to the built-in five.
 */
export async function activeColorsFor(material: string): Promise<ColorSwatch[]> {
  const rows = await db.materialColor.findMany({
    where: { material, active: true },
    select: { name: true, hex: true },
    orderBy: ORDER,
  });
  return rows.length > 0 ? rows : BUILT_IN_PALETTE;
}

/**
 * Every material's palette at once, for the upload page. Materials with nothing
 * configured are simply absent from the map — the form knows to fall back — so
 * this stays one query rather than one per material.
 */
export async function activePalettes(): Promise<Record<string, ColorSwatch[]>> {
  const rows = await db.materialColor.findMany({
    where: { active: true },
    select: { material: true, name: true, hex: true },
    orderBy: ORDER,
  });

  const byMaterial: Record<string, ColorSwatch[]> = {};
  for (const row of rows) {
    (byMaterial[row.material] ??= []).push({ name: row.name, hex: row.hex });
  }
  return byMaterial;
}

/** Everything, retired colours included, for the Colours tab. */
export function listAllColors(): Promise<ColorRow[]> {
  return db.materialColor.findMany({
    select: { id: true, material: true, name: true, hex: true, active: true, sortOrder: true },
    orderBy: [{ material: "asc" as const }, ...ORDER],
  });
}

// ---------------------------------------------------------------------------
// Mutations (admin-only)
// ---------------------------------------------------------------------------

/** The material has to exist before it can have colours hung on it. */
async function assertMaterial(material: string): Promise<void> {
  const exists = await db.material.findUnique({ where: { name: material }, select: { name: true } });
  if (!exists) throw new ColorProblem(`“${material}” is not on the materials list.`);
}

export async function createColor(
  actor: Actor,
  material: string,
  rawName: unknown,
  rawHex: unknown,
): Promise<ColorRow> {
  assertAdmin(actor);
  await assertMaterial(material);
  const { name, hex } = parse(rawName, rawHex);

  const last = await db.materialColor.findFirst({
    where: { material },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  let created;
  try {
    created = await db.materialColor.create({
      data: { material, name, hex, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
  } catch {
    throw new ColorProblem(`“${name}” is already on ${material}'s colour list.`);
  }

  await record({ action: "color.created", actor, subject: `${material} · ${name}`, detail: { hex } });
  refresh();
  return created;
}

/**
 * Rename a colour and/or change its swatch. Past tickets are untouched by
 * design: they carry the name and hex they were asked for, so a recolour shows
 * on the next request and nowhere else.
 */
export async function updateColor(
  actor: Actor,
  id: string,
  rawName: unknown,
  rawHex: unknown,
): Promise<ColorRow> {
  assertAdmin(actor);

  const existing = await db.materialColor.findUnique({ where: { id } });
  if (!existing) throw new ColorProblem("That colour is no longer on the list.");
  const { name, hex } = parse(rawName, rawHex);
  if (existing.name === name && existing.hex === hex) return existing;

  try {
    const updated = await db.materialColor.update({ where: { id }, data: { name, hex } });
    await record({
      action: "color.updated",
      actor,
      subject: `${updated.material} · ${updated.name}`,
      detail: { from: { name: existing.name, hex: existing.hex }, to: { name, hex } },
    });
    refresh();
    return updated;
  } catch {
    throw new ColorProblem(`“${name}” is already on ${existing.material}'s colour list.`);
  }
}

/** Retire (or restore). A retired colour drops off the form, nothing else. */
export async function setColorActive(actor: Actor, id: string, active: boolean): Promise<void> {
  assertAdmin(actor);

  const existing = await db.materialColor.findUnique({ where: { id } });
  if (!existing) throw new ColorProblem("That colour is no longer on the list.");
  if (existing.active === active) return;

  await db.materialColor.update({ where: { id }, data: { active } });
  await record({
    action: active ? "color.restored" : "color.retired",
    actor,
    subject: `${existing.material} · ${existing.name}`,
  });
  refresh();
}

/**
 * Put the five built-in swatches on a material's list.
 *
 * The fallback covers a fresh deployment, but a palette the owner cannot see is
 * a palette they cannot edit — so the Colours tab offers this for a material
 * with nothing configured, turning the implicit into five rows. `skipDuplicates`
 * is what makes it safe to press twice, and what stops it resurrecting a colour
 * the owner deliberately retired.
 */
export async function addBuiltInColors(actor: Actor, material: string): Promise<number> {
  assertAdmin(actor);
  await assertMaterial(material);

  const { count } = await db.materialColor.createMany({
    data: BUILT_IN_PALETTE.map((swatch, index) => ({
      material,
      name: swatch.name,
      hex: swatch.hex,
      sortOrder: index + 1,
    })),
    skipDuplicates: true,
  });

  await record({
    action: "color.created",
    actor,
    subject: material,
    detail: { added: count, palette: "built-in" },
  });
  refresh();
  return count;
}
