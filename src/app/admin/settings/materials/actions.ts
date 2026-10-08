"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import { MaterialProblem, createMaterial, renameMaterial, setMaterialActive, setMaterialRate } from "@/lib/materials";

/**
 * The admin's controls for the materials catalogue, as plain server-action
 * forms. The rules and the audit live in `src/lib/materials.ts`; this reads a
 * `FormData`, calls the operation and redirects with a toast. Every action
 * re-checks the role: rendering the page is not authorisation.
 *
 * The redirect comes back to `/admin/settings/materials`, the Materials tab,
 * because that is the page these forms are rendered on.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/settings/materials?${new URLSearchParams(params).toString()}`);
}

export async function createMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  try {
    const m = await createMaterial(admin, formData.get("name") ?? "");
    back({ toast: `Added “${m.name}”` });
  } catch (error) {
    if (error instanceof MaterialProblem) back({ error: error.message });
    throw error;
  }
}

export async function renameMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  try {
    const m = await renameMaterial(admin, id, formData.get("name") ?? "");
    back({ toast: `Renamed to “${m.name}”` });
  } catch (error) {
    if (error instanceof MaterialProblem) back({ error: error.message });
    throw error;
  }
}

export async function setMaterialActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  try {
    await setMaterialActive(admin, id, active);
    back({ toast: active ? "Back on the list" : "Retired" });
  } catch (error) {
    if (error instanceof MaterialProblem) back({ error: error.message });
    throw error;
  }
}

export async function setMaterialRateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "");
  try {
    await setMaterialRate(admin, name, formData.get("dollarsPerKg") ?? "");
    back({ toast: `Rate saved for “${name}”` });
  } catch (error) {
    if (error instanceof MaterialProblem) back({ error: error.message });
    throw error;
  }
}
