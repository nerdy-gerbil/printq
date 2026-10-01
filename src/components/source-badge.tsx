import { modelSourceFor } from "@/lib/model-sources";

/**
 * Where a model came from, as a chip.
 *
 * A ticket's optional `sourceUrl` and a wishlist row both wear the same
 * badge so the two read alike — see `src/lib/model-sources.ts` for why the
 * match is a hostname table and not an API. Unknown hosts fall back to the
 * hostname itself: a badge saying where it came from beats no badge.
 */
export function SourceBadge({ url }: { url: string }) {
  const source = modelSourceFor(url);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // The upload route validates before storing, so this is belt and braces.
    return null;
  }
  const label = source ?? host;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-[5px] rounded-chip border-2 border-ink bg-porcelain px-[9px] py-[2px] font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-ink hover:bg-cream-2"
      title={url}
    >
      <span aria-hidden>↗</span>
      {label}
    </a>
  );
}
