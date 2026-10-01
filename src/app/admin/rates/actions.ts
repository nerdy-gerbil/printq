"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import { CostProblem, setMachineRate } from "@/lib/cost";

/**
 * The admin's control for the machine rate, as a plain server-action form.
 * The rule and the audit live in `src/lib/cost.ts`; this reads a `FormData`,
 * calls the operation and redirects with a toast. The role is re-checked
 * there: rendering the page is not authorisation.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/rates?${new URLSearchParams(params).toString()}`);
}

export async function setMachineRateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  try {
    await setMachineRate(admin, formData.get("dollarsPerHour") ?? "");
    back({ toast: "Machine rate saved" });
  } catch (error) {
    if (error instanceof CostProblem) back({ error: error.message });
    throw error;
  }
}
