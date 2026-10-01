"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import { WishlistProblem, addWish, removeWish } from "@/lib/wishlist";

/**
 * The admin's controls for the wishlist, as plain server-action forms. The
 * rules, the fetch and the audit live in `src/lib/wishlist.ts`; this reads a
 * `FormData`, calls the operation and redirects with a toast. The role is
 * re-checked there: rendering the page is not authorisation.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/wishlist?${new URLSearchParams(params).toString()}`);
}

export async function addWishAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  try {
    const w = await addWish(admin, formData.get("url") ?? "", formData.get("note") ?? "");
    back({ toast: `“${w.title}” is on the list` });
  } catch (error) {
    if (error instanceof WishlistProblem) back({ error: error.message });
    throw error;
  }
}

export async function removeWishAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  try {
    await removeWish(admin, id);
    back({ toast: "Taken off the list" });
  } catch (error) {
    if (error instanceof WishlistProblem) back({ error: error.message });
    throw error;
  }
}
