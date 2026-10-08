import "server-only";
import { cache } from "react";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import { CURRENCIES, DEFAULT_CURRENCY, isCurrency, type Currency } from "@/lib/money";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import type { Actor } from "@/lib/scope";

/**
 * The settings an owner sets once: what money looks like, whether the shop is
 * taking orders, how big an upload may be, how long an invitation lives, and
 * what the team is called.
 *
 * Stored as one row per key (`Setting`), the value JSON-encoded, and read back
 * through the registry below. Three rules make that safe:
 *
 *   - Defaults live here, not in the database. A key with no row, a row whose
 *     value no longer parses, or a table that has not been created yet all
 *     resolve to the default, so a page cannot be taken down by a setting.
 *     Anything ignored is logged loudly rather than silently.
 *   - Validation lives here too, and runs on the way *in*. The only writer is
 *     `updateSettings`, so a hand-edited row is the only way invalid data
 *     arrives — and that is a repair, not a path.
 *   - Reading is `cache`d per request. The header, the queue and the ledger all
 *     want the currency, and that is still one query.
 *
 * What is *not* here is as deliberate as what is: rates, materials and benefits
 * have their own screens, because a material and its price per kilogram are one
 * fact and two screens that can disagree about it is how drift starts. This
 * page links to them instead of repeating them.
 */

export type AppSettings = {
  /** ISO 4217 code, e.g. "EUR". See src/lib/money.ts. */
  currency: Currency;
  /** Percent added on top of the derived cost, so a price can be a price. */
  markupPercent: number;
  /** Floor for the price, in the chosen currency. 0 disables it. */
  minimumCharge: number;
  /** Refuse new requests — away, out of filament, mid-move. */
  ordersPaused: boolean;
  /** What the upload page says while the shop is paused. */
  pausedMessage: string;
  /**
   * Material the upload form starts on. Empty means "whatever is first on the
   * materials list", which is also the fallback when the named material has
   * since been retired.
   */
  defaultMaterial: string;
  /** Soft cap on a model, in MB. The compiled 250 MB ceiling still applies. */
  maxUploadMb: number;
  /** How long an invitation link stays good. */
  inviteExpiryDays: number;
  /** Used in copy: "Invited by …", "…'s queue". */
  teamName: string;
};

/**
 * The hard ceiling, from the module both the server and the form read. The
 * setting can only ever lower it: the transport limit in next.config.ts is
 * baked at build time, so a runtime value above it would be a promise the
 * server cannot keep.
 */
export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));

export const DEFAULT_SETTINGS: AppSettings = {
  currency: DEFAULT_CURRENCY,
  markupPercent: 0,
  minimumCharge: 0,
  ordersPaused: false,
  pausedMessage: "",
  defaultMaterial: "",
  maxUploadMb: MAX_UPLOAD_MB,
  inviteExpiryDays: 7,
  teamName: "the print team",
};

/** Which group of the screen a setting is edited in. */
export const SETTING_SECTIONS = ["money", "orders", "people", "identity"] as const;
export type SettingSection = (typeof SETTING_SECTIONS)[number];

export class SettingProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingProblem";
  }
}

type Codec<K extends keyof AppSettings> = {
  section: SettingSection;
  /** What the admin screen calls it. */
  label: string;
  /** One line under the field, in the voice of the screen. */
  help: string;
  /**
   * "checkbox" fields post nothing when unchecked, so absence means false.
   * Every other kind is absent only if some other form posted, which is why
   * `updateSettings` skips what it was not given.
   */
  kind: "field" | "checkbox";
  /** Validates one value, from a form field or from the stored JSON. */
  parse(raw: unknown): AppSettings[K];
  /** How the current value is shown in the field. */
  show(value: AppSettings[K]): string;
  /**
   * A numeric field's own hint, for the browser. The rule is `parse` above;
   * this is the same limits next to it rather than on a second page, because
   * a `max` that disagrees with the validator is a form that offers a value
   * the server refuses.
   */
  bounds?: { min: number; max: number; step: number };
};

const text = (raw: unknown): string =>
  typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();

/** Accepts "1,50" as well as "1.50" — a person on a comma locale types that. */
function numberFrom(raw: unknown, what: string): number {
  if (typeof raw === "number") return raw;
  const cleaned = text(raw).replace(",", ".");
  if (cleaned === "") throw new Error(`give it a number, or 0 for none.`);
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`"${cleaned}" is not a number.`);
  return value;
}

/** true only for the values a checkbox and JSON actually produce. */
function booleanFrom(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const value = text(raw).toLowerCase();
  return value === "true" || value === "on" || value === "1" || value === "yes";
}

const CODECS: { [K in keyof AppSettings]: Codec<K> } = {
  currency: {
    section: "money",
    label: "Currency",
    help: "Every price, rate and total in the app is shown in this currency.",
    kind: "field",
    parse: (raw) => {
      const value = text(raw);
      if (!isCurrency(value)) {
        throw new Error(`"${value}" is not one of the currencies on the list.`);
      }
      return value;
    },
    show: (value) => value,
  },
  markupPercent: {
    section: "money",
    label: "Markup on cost",
    help: "Percent added on top of filament plus machine time, so the price covers more than the cost. 0 shows the raw cost.",
    kind: "field",
    parse: (raw) => {
      const value = numberFrom(raw, "markup");
      if (value < 0) throw new Error("a markup cannot be negative.");
      if (value > 500) throw new Error("that looks like a typo — 500% is the ceiling.");
      return Math.round(value * 100) / 100;
    },
    show: (value) => String(value),
    bounds: { min: 0, max: 500, step: 0.01 },
  },
  minimumCharge: {
    section: "money",
    label: "Minimum charge",
    help: "A floor under the price, for the small jobs that would otherwise come out at pennies. 0 turns it off.",
    kind: "field",
    parse: (raw) => {
      const value = numberFrom(raw, "minimum charge");
      if (value < 0) throw new Error("a minimum charge cannot be negative.");
      if (value > 100_000) throw new Error("that looks like a typo.");
      return Math.round(value * 100) / 100;
    },
    show: (value) => String(value),
    bounds: { min: 0, max: 100_000, step: 0.01 },
  },
  ordersPaused: {
    section: "orders",
    label: "Pause new orders",
    help: "Stops the upload form accepting anything, with the message below. Existing tickets keep moving.",
    kind: "checkbox",
    parse: booleanFrom,
    show: () => "",
  },
  pausedMessage: {
    section: "orders",
    label: "What to say while paused",
    help: "Shown at the top of the upload page. Left empty, people are told the printer is not taking work and to ask the team.",
    kind: "field",
    parse: (raw) => {
      const value = text(raw);
      if (value.length > 200) throw new Error("keep it under 200 characters.");
      return value;
    },
    show: (value) => value,
  },
  defaultMaterial: {
    section: "orders",
    label: "Default material",
    help: "Which material the upload form starts on. Empty means the first one on the materials list.",
    kind: "field",
    parse: (raw) => {
      const value = text(raw);
      if (value.length > 40) throw new Error("that is longer than a material name can be.");
      return value;
    },
    show: (value) => value,
  },
  maxUploadMb: {
    section: "orders",
    label: "Largest model (MB)",
    help: `Refused before it is read. This can only lower the app's built-in ${MAX_UPLOAD_MB} MB ceiling.`,
    kind: "field",
    parse: (raw) => {
      const value = numberFrom(raw, "size limit");
      if (!Number.isInteger(value)) throw new Error("give it whole megabytes.");
      if (value < 1) throw new Error("at least 1 MB, or turn uploads off by pausing orders.");
      if (value > MAX_UPLOAD_MB) {
        throw new Error(`${MAX_UPLOAD_MB} MB is as high as this build goes.`);
      }
      return value;
    },
    show: (value) => String(value),
    bounds: { min: 1, max: MAX_UPLOAD_MB, step: 1 },
  },
  inviteExpiryDays: {
    section: "people",
    label: "Invitations expire after",
    help: "Days an invitation link stays good. Resending an invite rotates its link and starts this again.",
    kind: "field",
    parse: (raw) => {
      const value = numberFrom(raw, "expiry");
      if (!Number.isInteger(value)) throw new Error("give it whole days.");
      if (value < 1) throw new Error("at least a day.");
      if (value > 90) throw new Error("90 days is the ceiling — past that, resend instead.");
      return value;
    },
    show: (value) => String(value),
    bounds: { min: 1, max: 90, step: 1 },
  },
  teamName: {
    section: "identity",
    label: "What the team is called",
    help: 'Used wherever the app would say "the print team" — the queue heading, invitation copy, notifications.',
    kind: "field",
    parse: (raw) => {
      const value = text(raw);
      if (value === "") throw new Error("give it a name — this appears in copy.");
      if (value.length > 40) throw new Error("keep it under 40 characters.");
      return value;
    },
    show: (value) => value,
  },
};

/** The keys one section's form is allowed to write, in screen order. */
export function settingsInSection(section: SettingSection): Array<keyof AppSettings> {
  return (Object.keys(CODECS) as Array<keyof AppSettings>).filter(
    (key) => CODECS[key].section === section,
  );
}

export function settingLabel(key: keyof AppSettings): string {
  return CODECS[key].label;
}

export function settingHelp(key: keyof AppSettings): string {
  return CODECS[key].help;
}

export function settingKind(key: keyof AppSettings): "field" | "checkbox" {
  return CODECS[key].kind;
}

/**
 * Like the other two accessors, for a page walking the registry by key: the
 * value arrives as the union of every setting's type, which cannot be narrowed
 * by indexing, so the codec is handed it the way it validated it.
 */
export function settingShown(key: keyof AppSettings, value: unknown): string {
  return CODECS[key].show(value as never);
}

export function settingBounds(
  key: keyof AppSettings,
): { min: number; max: number; step: number } | null {
  return CODECS[key].bounds ?? null;
}

/**
 * Every setting, defaults filled in. Cached for the request: the header, the
 * queue and each ticket's ledger all ask, and this is one query.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  let rows: Array<{ key: string; value: string }> = [];
  try {
    rows = await db.setting.findMany({ select: { key: true, value: true } });
  } catch (error) {
    // A database whose reconciliation has not run yet has no `setting` table.
    // Falling back to the defaults keeps every page working and changes
    // nothing until the table exists — and says so, rather than pretending.
    console.warn("[settings] could not read the settings table; using defaults", error);
    return { ...DEFAULT_SETTINGS };
  }

  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in CODECS)) continue;
    const key = row.key as keyof AppSettings;
    try {
      const stored = JSON.parse(row.value) as unknown;
      // The cast is the registry's whole promise: `parse` returned this key's
      // own type, and the union it widens to cannot be narrowed by indexing.
      (settings as Record<string, unknown>)[key] = CODECS[key].parse(stored);
    } catch (error) {
      console.warn(
        `[settings] ignoring unusable value for ${row.key}; using the default`,
        error,
      );
    }
  }
  return settings;
});

/**
 * Save one section's form. Admin-only and audited, like every other mutation
 * of owner-managed data, and re-checked here rather than trusted from the
 * page: rendering a form is not authorisation.
 *
 * Returns how many values actually changed, so the screen can say "saved" or
 * "nothing changed" honestly.
 */
export async function updateSettings(
  actor: Actor,
  section: SettingSection,
  form: FormData,
): Promise<number> {
  if (actor.role !== "admin") {
    throw new SettingProblem("Only an admin changes the settings.");
  }

  const before = await getSettings();
  const changes: Array<{ key: keyof AppSettings; json: string; from: unknown; to: unknown }> = [];

  for (const key of settingsInSection(section)) {
    const codec = CODECS[key];
    // An unchecked box posts nothing at all; every other kind is absent only
    // when a different section's form was submitted, which is not ours to
    // write.
    const raw = codec.kind === "checkbox" ? form.get(key) !== null : form.get(key);
    if (raw === null) continue;

    let value: AppSettings[typeof key];
    try {
      value = codec.parse(raw) as AppSettings[typeof key];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "check that value.";
      throw new SettingProblem(`${codec.label}: ${reason}`);
    }

    if (value === before[key]) continue;
    changes.push({ key, json: JSON.stringify(value), from: before[key], to: value });
  }

  if (changes.length === 0) return 0;

  try {
    await db.$transaction(
      changes.map((change) =>
        db.setting.upsert({
          where: { key: change.key },
          update: { value: change.json },
          create: { key: change.key, value: change.json },
        }),
      ),
    );
  } catch (error) {
    // The one failure worth naming: a database whose reconciliation has not
    // run has no `setting` table, and "P2021" tells the person holding the
    // deploy button nothing at all.
    console.error("[settings] could not save", error);
    throw new SettingProblem(
      "The settings table is missing or unreachable — this deployment's database needs reconciling (npm run predeploy:db:reconcile) before settings can be saved.",
    );
  }

  for (const change of changes) {
    await record({
      action: "setting.changed",
      actor,
      subject: CODECS[change.key].label,
      detail: { key: change.key, from: change.from ?? null, to: change.to },
    });
  }

  // Dynamic pages re-read on every request, but the header copy ("…'s queue")
  // and the cached settings object are worth dropping explicitly.
  revalidatePath("/", "layout");
  return changes.length;
}
