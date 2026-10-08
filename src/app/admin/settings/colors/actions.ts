"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import {
  ColorProblem,
  addBuiltInColors,
  createColor,
  setColorActive,
  updateColor,
} from "@/lib/colors";

/**
 * The admin's controls for the per-material colour lists, as plain server-action
 * forms. The rules and the audit live in `src/lib/colors.ts`; this reads a
 * `FormData`, calls the operation and redirects with a toast. Every action
 * re-checks the role: rendering the page is not authorisation.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/settings/colors?${new URLSearchParams(params).toString()}`);
}

export async function createColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const material = String(formData.get("material") ?? "");
  try {
    const color = await createColor(admin, material, formData.get("name"), formData.get("hex"));
    back({ toast: `Added “${color.name}” to ${material}` });
  } catch (error) {
    if (error instanceof ColorProblem) back({ error: error.message });
    throw error;
  }
}

export async function updateColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  try {
    const color = await updateColor(admin, id, formData.get("name"), formData.get("hex"));
    back({ toast: `Saved “${color.name}”` });
  } catch (error) {
    if (error instanceof ColorProblem) back({ error: error.message });
    throw error;
  }
}

export async function setColorActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  try {
    await setColorActive(admin, id, active);
    back({ toast: active ? "Back on the form" : "Retired" });
  } catch (error) {
    if (error instanceof ColorProblem) back({ error: error.message });
    throw error;
  }
}

export async function addBuiltInColorsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const material = String(formData.get("material") ?? "");
  try {
    const added = await addBuiltInColors(admin, material);
    back({
      toast:
        added === 0
          ? `${material} already had those colours`
          : `Added ${added} colour${added === 1 ? "" : "s"} to ${material}`,
    });
  } catch (error) {
    if (error instanceof ColorProblem) back({ error: error.message });
    throw error;
  }
}
