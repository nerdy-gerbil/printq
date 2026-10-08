import { redirect } from "next/navigation";

/**
 * The materials page moved under the settings screen, onto the Materials tab
 * at `/admin/settings/materials`, where it sits beside the machine's rates and
 * the colours each material is offered in — one subject, one roof.
 *
 * The old URL is kept rather than deleted because people bookmarked it, the
 * deployment notes quote it, and a plain 404 for a page that still exists
 * somewhere else is a worse answer than the page itself.
 */
export default function MaterialsMoved(): never {
  redirect("/admin/settings/materials");
}
