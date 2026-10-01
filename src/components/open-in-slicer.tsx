import { storyRef } from "@/lib/scope";
import { mintSlicerToken } from "@/lib/slicer-token";

/**
 * "Open in PrusaSlicer" / "Open in Anycubic Slicer Next (FDM)" — links to the
 * `printq://` and `printq-anycubic://` schemes, handled by helpers on the
 * viewer's own machine.
 *
 * Why a bare `<a>` to a custom scheme rather than a download, a signed URL,
 * or the slicers' own deep links:
 *
 *   - PrusaSlicer's `prusaslicer://open?file=` only downloads from a
 *     hardcoded allowlist (printables.com, thingiverse.com, cults3d.com) and
 *     there is no setting to add to it — a self-hosted instance can never be
 *     on that list. See docs/prusaslicer.md.
 *   - Anycubic Slicer Next (Orca-based) has the same shape of problem: its
 *     model deep links are wired to Makeronline's own service, and there is
 *     no setting that teaches it a self-hosted host.
 *   - So the file is fetched by a small helper the printer owner installs
 *     once (`scripts/prusa-open.sh`, `scripts/anycubic-open.sh`), which hands
 *     the slicer a *local* path. A local file has no domain to check, so the
 *     allowlist never applies — that is the design, not a loophole.
 *
 * These links add nothing to the server and need no client bundle: clicking
 * invokes the OS protocol handler, which is not a fetch, so the CSP does not
 * govern it and there is no JavaScript here. On a machine with no helper
 * installed the click simply does nothing — the copy says as much, and links
 * to the one-time setup.
 *
 * Each link carries the ticket id **and a short-lived credential minted for
 * the person reading this page**: good for half an hour, for this model only,
 * and it authorises nothing on its own — the route re-checks the account and
 * re-applies `storyScope`. The SAME token works for either button: it asserts
 * identity and subject, not a slicer. Minted once, rendered twice.
 *
 * `DownloadModel` sits beside this rather than inside it: the same bytes with
 * no helper at all, for the printer owner who is not at the machine with the
 * slicer on it. Putting it behind this disclosure would have hidden the plain
 * answer behind the clever one.
 */
export function OpenInSlicer({
  storyId,
  userId,
}: {
  storyId: number;
  /** Who the link credential is minted for. */
  userId: string;
}) {
  const token = mintSlicerToken(userId, storyId);

  return (
    <details className="group mt-[13.2px]">
      <summary className="stamp inline-flex cursor-pointer list-none items-center gap-[8px] rounded-chip border-[3px] border-ink bg-porcelain px-[15px] py-[8px] text-[14px] font-bold text-ink hover:bg-sun">
        {/* An unadorned wedge, not a brand mark — nothing here claims to be
            Prusa's or Anycubic's. */}
        <span aria-hidden className="font-mono text-[15px] leading-none">▸</span>
        Open in a slicer
      </summary>

      <div className="mt-[8.8px] rounded-card border-[3px] border-ink bg-cream-2 p-[13.2px]">
        <div className="flex flex-wrap gap-[8.8px]">
          <a
            href={`printq://slice/${storyId}?t=${token}`}
            className="stamp inline-block cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[18px] py-[8px] text-[14px] font-bold text-cream hover:bg-cherry"
          >
            Open in PrusaSlicer
          </a>
          <a
            href={`printq-anycubic://slice/${storyId}?t=${token}`}
            className="stamp inline-block cursor-pointer rounded-chip border-[3px] border-ink bg-aqua px-[18px] py-[8px] text-[14px] font-bold text-ink hover:bg-sun"
          >
            Open in Anycubic Slicer Next (FDM)
          </a>
        </div>
        <p className="m-0 mt-[8.8px] font-mono text-[11px] leading-[1.5] text-ink-2">
          Opens the slicer on <strong>this</strong> machine. Needs the one-time
          helper — see{" "}
          <a
            href="https://github.com/nerdy-gerbil/printq/blob/main/docs/prusaslicer.md"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-cherry-dk"
          >
            the setup
          </a>
          . Nothing happens if it is not installed — the download beside this
          works anywhere.
        </p>
      </div>
    </details>
  );
}
