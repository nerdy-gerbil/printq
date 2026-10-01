/**
 * 3D-model source sites, recognised by hostname.
 *
 * Two callers, one table: the wishlist derives its Source badge from the URL
 * the admin pasted, and a ticket's optional sourceUrl gets the same badge so
 * the two read alike. Deliberately hostname-based rather than API-shaped —
 * none of these sites publish a download API that would let the app fetch a
 * model itself, so all the URL is ever used for is display and a badge.
 *
 * Matched on the registrable domain (the last two labels, three for
 * co.uk-style), so `www.printables.com` and `printables.com` both hit while
 * `notprintables.com` cannot. Shared with the client bundle: no `server-only`.
 */

type SourceRule = {
  /** Registrable domain suffix, dot-stripped. */
  match: string;
  label: string;
};

const SOURCES: SourceRule[] = [
  { match: "makeronline.com", label: "Makeronline" },
  { match: "printables.com", label: "Printables" },
  { match: "makerworld.com", label: "MakerWorld" },
  { match: "thingiverse.com", label: "Thingiverse" },
  { match: "cults3d.com", label: "Cults3D" },
  { match: "thangs.com", label: "Thangs" },
  { match: "myminifactory.com", label: "MyMiniFactory" },
  { match: "grabcad.com", label: "GrabCAD" },
  { match: "yeggi.com", label: "Yeggi" },
  { match: "3dexport.com", label: "3DExport" },
  { match: "cgtrader.com", label: "CGTrader" },
  { match: "tinkercad.com", label: "Tinkercad" },
  { match: "github.com", label: "GitHub" },
];

/** The last n dot-separated labels of a hostname (1 = TLD, 2 = domain…). */
function registrable(hostname: string, n: number): string {
  const labels = hostname.split(".").filter(Boolean);
  return labels.slice(-n).join(".");
}

/**
 * A human label for where a model lives, or null when the host is not one of
 * the sites the app recognises. The caller decides what null renders as —
 * the wishlist falls back to the hostname itself.
 */
export function modelSourceFor(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const n of [3, 2, 1]) {
    const suffix = registrable(host, n);
    const rule = SOURCES.find((s) => s.match === suffix);
    if (rule) return rule.label;
  }
  return null;
}
