"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import {
  SETTING_SECTIONS,
  SettingProblem,
  updateSettings,
  type SettingSection,
} from "@/lib/settings";

/**
 * One action behind every form on the settings screen.
 *
 * The section arrives as a field on the form and is checked against the
 * registry's own list of sections, so a hand-crafted post can only ever name a
 * section that exists — and `updateSettings` walks that section's keys rather
 * than the fields it was handed, so nothing outside the registry can be
 * written. The validation, the audit trail and the revalidation all live in
 * `src/lib/settings.ts`; this is the thin web half, like every other admin
 * action here.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/settings?${new URLSearchParams(params).toString()}`);
}

function isSection(value: unknown): value is SettingSection {
  return typeof value === "string" && (SETTING_SECTIONS as readonly string[]).includes(value);
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const section = formData.get("section");
  if (!isSection(section)) {
    back({ error: "That form did not come from this screen — reload the page and try again." });
  }

  try {
    const changed = await updateSettings(admin, section, formData);
    back({
      toast:
        changed === 0
          ? "Nothing changed"
          : `${changed} setting${changed === 1 ? "" : "s"} saved`,
    });
  } catch (error) {
    if (error instanceof SettingProblem) back({ error: error.message });
    throw error;
  }
}
