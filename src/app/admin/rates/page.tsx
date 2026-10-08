import { redirect } from "next/navigation";

/**
 * The rates screen moved under Settings, where it sits beside the Materials
 * tab it is drawn from and the General tab that holds markup and currency —
 * one screen for what the shop pays and what it charges, rather than two that
 * each carry a note about where the other one is. This URL is kept rather
 * than dropped because it was linked from the header nav, quoted in the
 * deployment notes and bookmarked by whoever runs the machine.
 */
export default function RatesMoved(): never {
  redirect("/admin/settings/rates");
}
