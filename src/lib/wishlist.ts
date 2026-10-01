import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import type { Actor } from "@/lib/scope";
import { modelSourceFor } from "@/lib/model-sources";
import { deleteModel, putModel } from "@/lib/storage";

/**
 * The wishlist — things somebody saw on a model site and wants printed, filed
 * before anyone decides when or in what.
 *
 * The admin pastes a product URL; the app fetches the page ONCE to pick up a
 * title and a picture, caches the picture into the models volume, and stores
 * the row. After that the app never calls the site again — the thumbnail is a
 * cached copy, the link goes straight to the shop, and a site going down or
 * changing its markup cannot break this screen.
 *
 * **The fetch is the security-sensitive part**, and the guards are absolute
 * rather than clever. The URL comes from a person, and a person can be
 * social-engineered — or simply paste something odd — so what the server will
 * happily reach for is constrained:
 *
 *   - `https://` only, with no credentials embedded (`user:pass@host`).
 *   - The host must look like a public site: a dot in it, no IP literal in a
 *     loopback/private/link-local range, and no `localhost`, `.local`,
 *     `.internal` or bare single-label names — the last is the one a compose
 *     network answers (`db`, `app`), so "no dot" is refused outright.
 *   - Two outbound fetches per add, each on a 10-second timeout, each body
 *     capped (1 MB of page, 5 MB of picture) by cancelling the stream, not
 *     by buffering and hoping.
 *   - Both fetches are fire-and-collect: a site that hangs, a missing
 *     og:image or a non-image thumbnail all leave a perfectly good row with
 *     no picture. Nothing about the fetch failing blocks the wish.
 *
 * Dedupe is the database: `url` is unique, and a P2002 is translated into a
 * sentence instead of a stack.
 */

export class WishlistProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WishlistProblem";
  }
}

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const UrlSchema = z
  .string()
  .trim()
  .startsWith("https://", "Only an https link, please — the fetch is the one thing that runs on the server's network.")
  .max(500, "That link is longer than links get.");

const NoteSchema = z
  .string()
  .trim()
  .max(280, "Keep the note under 280 characters — it is a whisper on the list, not a letter.");

/** How long the site has to answer each request. */
const FETCH_TIMEOUT_MS = 10_000;
/** The most of an HTML page worth reading; the tags we want are in the head. */
const PAGE_CAP = 1_000_000;
/** The most of a picture worth caching. */
const THUMB_CAP = 5_000_000;

/**
 * The host gate. Written as refusals, not as an allowlist — the wish is for
 * shops nobody has thought of yet, and an allowlist would need maintaining
 * more honestly than anyone would.
 */
function assertPublicFetchable(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (url.protocol !== "https:") {
    throw new WishlistProblem("Only an https link, please.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new WishlistProblem("That link embeds credentials — paste the plain public page instead.");
  }
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    throw new WishlistProblem("That link points at this machine, not at a shop.");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    throw new WishlistProblem("That is an internal name — the app only fetches public sites.");
  }
  // A bare single label resolves through the search domain — on the compose
  // network that is exactly how "db" and "app" answer. Refuse the whole class.
  if (!host.includes(".")) {
    throw new WishlistProblem("That is not a public hostname.");
  }
  if (host.includes(":")) {
    // Bracketed or bare IPv6 literal; the app has no business dialing one.
    throw new WishlistProblem("Paste a domain, not an IP address.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    const private_ =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224; // multicast and reserved
    if (private_) {
      throw new WishlistProblem("That link points at a private address — the app only fetches public sites.");
    }
  }
}

function assertPublicHttps(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WishlistProblem("That does not look like a link.");
  }
  assertPublicFetchable(url);
  return url;
}

/**
 * Read a response body, hard-capped: the stream is *cancelled* once over the
 * cap, so a hostile 4 GB response costs a megabyte of memory and ten seconds,
 * not the disk.
 */
async function readCapped(response: Response, cap: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel();
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(Math.min(total, cap));
  let at = 0;
  for (const c of chunks) {
    if (at >= cap) break;
    out.set(c.subarray(0, Math.min(c.length, cap - at)), at);
    at += c.length;
  }
  return out;
}

/** The handful of entities a title actually carries. No HTML parser, no DOM, no surprises. */
function decodeEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function metaContent(html: string, property: string): string | null {
  // Property-first and content-first, because real sites order attributes
  // both ways and a regex has no opinion about which is "correct".
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

function titleFromHtml(html: string): string | null {
  const og = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  if (og) return og;
  const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return t?.[1] ? decodeEntities(t[1]).trim() : null;
}

function slugFromUrl(url: URL): string | null {
  const seg = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const cleaned = decodeURIComponent(seg)
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function cleanTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
}

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * Fetch the page, pick a title and a picture. Never throws for "the site was
 * unhelpful" — the outcome is a wish with no picture and its URL as its name,
 * which is still a perfectly good wish.
 */
async function collectMeta(pageUrl: URL): Promise<{ title: string | null; thumbnailKey: string | null }> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      redirect: "follow",
      signal: timeout,
      headers: { accept: "text/html,*/*;q=0.8", "user-agent": "PrintQ wishlist (+1 image fetch; polite)" },
    });
    if (!res.ok) return { title: null, thumbnailKey: null };
    html = new TextDecoder("utf-8", { fatal: false }).decode(await readCapped(res, PAGE_CAP));
  } catch {
    return { title: null, thumbnailKey: null };
  }

  const title = titleFromHtml(html);

  // The picture: another https, publicly-fetchable URL, another cap, and the
  // response must *say* it is an image — a "thumbnail" that is really a
  // content-type lie does not get cached.
  const imageSrc = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (!imageSrc) return { title, thumbnailKey: null };
  try {
    const imageUrl = new URL(imageSrc, pageUrl);
    assertPublicFetchable(imageUrl);
    const res = await fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*,*/*;q=0.5", "user-agent": "PrintQ wishlist (+1 image fetch; polite)" },
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_EXT[type];
    if (!res.ok || !ext) return { title, thumbnailKey: null };
    const bytes = await readCapped(res, THUMB_CAP);
    if (bytes.byteLength === 0) return { title, thumbnailKey: null };
    const key = `thumbs/${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    await putModel(key, bytes);
    return { title, thumbnailKey: key };
  } catch {
    // A thumbnail that would not fetch is a wish without a picture, not an error.
    return { title, thumbnailKey: null };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type WishRow = Prisma.WishlistItemGetPayload<{
  select: {
    id: true;
    url: true;
    title: true;
    thumbnailKey: true;
    source: true;
    note: true;
    createdAt: true;
    addedBy: { select: { id: true; name: true; initials: true } };
  };
}>;

/** The board, newest first, with who asked. Admin-only at the page layer. */
export function listWishlist(): Promise<WishRow[]> {
  return db.wishlistItem.findMany({
    select: {
      id: true,
      url: true,
      title: true,
      thumbnailKey: true,
      source: true,
      note: true,
      createdAt: true,
      addedBy: { select: { id: true, name: true, initials: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Mutations (admin-only)
// ---------------------------------------------------------------------------

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw new WishlistProblem("Only an admin keeps the wishlist.");
  }
}

function refresh() {
  revalidatePath("/admin/wishlist");
}

/**
 * Add a wish. Fetches the page once for a title and picture; a site that will
 * not cooperate still leaves a row — the URL and the note carry the meaning.
 */
export async function addWish(actor: Actor, rawUrl: unknown, rawNote: unknown = ""): Promise<WishRow> {
  assertAdmin(actor);

  const parsedUrl = UrlSchema.safeParse(typeof rawUrl === "string" ? rawUrl : "");
  if (!parsedUrl.success) {
    throw new WishlistProblem(parsedUrl.error.issues[0]?.message ?? "Check that link.");
  }
  const parsedNote = NoteSchema.safeParse(typeof rawNote === "string" ? rawNote : "");
  if (!parsedNote.success) {
    throw new WishlistProblem(parsedNote.error.issues[0]?.message ?? "Check the note.");
  }

  const url = assertPublicHttps(parsedUrl.data);
  const { title, thumbnailKey } = await collectMeta(url);

  const name = title ? cleanTitle(title) : cleanTitle(slugFromUrl(url) ?? "") || url.hostname;
  const source = modelSourceFor(url.toString()) ?? url.hostname;

  try {
    const row = await db.wishlistItem.create({
      data: {
        url: url.toString(),
        title: name,
        thumbnailKey,
        source,
        note: parsedNote.data,
        addedById: actor.id,
      },
      select: {
        id: true, url: true, title: true, thumbnailKey: true, source: true,
        note: true, createdAt: true,
        addedBy: { select: { id: true, name: true, initials: true } },
      },
    });

    await record({
      action: "wishlist.added",
      actor,
      subject: source,
      detail: { title: row.title, url: row.url },
    });
    refresh();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The fetched thumbnail is now an orphan on disk; remove it rather than
      // leave bytes with no row pointing at them.
      if (thumbnailKey) await deleteModel(thumbnailKey).catch(() => undefined);
      throw new WishlistProblem("That one is already on the list.");
    }
    throw error;
  }
}

/** Take a wish off. The cached picture goes with it. */
export async function removeWish(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);

  const existing = await db.wishlistItem.findUnique({ where: { id } });
  if (!existing) throw new WishlistProblem("That wish is already gone.");

  await db.wishlistItem.delete({ where: { id } });
  if (existing.thumbnailKey) {
    await deleteModel(existing.thumbnailKey).catch(() => undefined);
  }

  await record({
    action: "wishlist.removed",
    actor,
    subject: existing.source,
    detail: { title: existing.title, url: existing.url },
  });
  refresh();
}
