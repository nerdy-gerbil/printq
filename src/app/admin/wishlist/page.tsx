import { requireAdmin } from "@/lib/authz";
import { listWishlist } from "@/lib/wishlist";
import { relativeTime } from "@/lib/catalog";
import { AppHeader } from "@/components/app-header";
import { SourceBadge } from "@/components/source-badge";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { addWishAction, removeWishAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The wishlist — things seen on model sites that somebody wants printed,
 * filed before anyone decides when or in what.
 *
 * The admin pastes a product link; the app fetches the page once for a title
 * and a picture (see `src/lib/wishlist.ts` for the guards around that), caches
 * the picture into the models volume, and keeps the row. The thumbnail below
 * is that cached copy, served through the session-checked route — never the
 * shop's own CDN, which would tell the shop who is browsing.
 *
 * Admin-only: `requireAdmin` answers 404, so a client learns nothing about
 * this route. Plain server-rendered forms, JavaScript off and it still works.
 */
export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const wishes = await listWishlist();

  return (
    <>
      <AppHeader user={admin} active="/admin/wishlist" />

      <main className="mx-auto w-full max-w-[980px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>Wishlist</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          Wants and maybes
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The queue of things to consider — paste a link to a model on a shop
          or a showcase, and the page&rsquo;s own title and picture are picked
          up. Nothing here is a promise: the wishlist is the intake, the board
          is the commitment.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {/* Add */}
        <form
          action={addWishAction}
          className="mb-[26.4px] rounded-panel border-[3px] border-ink bg-aqua-wash p-[17.6px] shadow-stamp"
        >
          <div className="flex flex-wrap items-end gap-[8.8px]">
            <div className="flex-[1_1_300px]">
              <label
                htmlFor="wish-url"
                className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
              >
                Link to the model
              </label>
              <input
                id="wish-url"
                name="url"
                type="url"
                required
                maxLength={500}
                autoComplete="off"
                placeholder="https://makeronline.com/…"
                className="w-full rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[11px] text-[15px] text-ink placeholder:text-ink-3"
              />
            </div>
            <div className="flex-[1_1_220px]">
              <label
                htmlFor="wish-note"
                className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
              >
                Note (optional)
              </label>
              <input
                id="wish-note"
                name="note"
                maxLength={280}
                autoComplete="off"
                placeholder="for the cable tray, maybe"
                className="w-full rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[11px] text-[15px] text-ink placeholder:text-ink-3"
              />
            </div>
            <button
              type="submit"
              className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[22px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
            >
              Add
            </button>
          </div>
          <p className="m-0 mt-[9px] text-[13px] leading-[1.45] text-ink-2">
            The page is fetched once, from the server, for the title and
            picture — public https links only.
          </p>
        </form>

        {/* The table */}
        {wishes.length === 0 ? (
          <p className="m-0 rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[13.2px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
            Nothing on the list yet — the next “ooh, print this” goes here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-panel border-[3px] border-ink bg-porcelain shadow-stamp">
            {wishes.map((w, i) => (
              <div
                key={w.id}
                className={`flex flex-wrap items-start gap-[13.2px] px-[17.6px] py-[13.2px] ${
                  i < wishes.length - 1 ? "border-b-2 border-dashed border-rule" : ""
                }`}
              >
                {/* Thumbnail — the cached copy, through the session-checked route */}
                {w.thumbnailKey ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/wishlist/${w.id}/thumb`}
                    alt=""
                    width={72}
                    height={72}
                    loading="lazy"
                    className="h-[72px] w-[72px] flex-none rounded-[8px] border-2 border-ink object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[8px] border-2 border-dashed border-ink-3 bg-cream-2 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3"
                  >
                    no pic
                  </span>
                )}

                <div className="min-w-[200px] flex-[1_1_300px]">
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-display text-[17px] leading-[1.25] text-ink underline-offset-4 hover:text-cherry-dk hover:underline"
                  >
                    {w.title}
                  </a>
                  {w.note && (
                    <p className="m-0 mt-[3px] text-[13.5px] leading-[1.45] text-ink-2">{w.note}</p>
                  )}
                  <p className="m-0 mt-[5px] font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
                    added by {w.addedBy.name} · {relativeTime(w.createdAt)}
                  </p>
                </div>

                <div className="flex flex-none items-center gap-[8.8px]">
                  <SourceBadge url={w.url} />
                  <form action={removeWishAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-chip border-2 border-ink bg-cream-2 px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink-2 hover:bg-cherry-wash"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
