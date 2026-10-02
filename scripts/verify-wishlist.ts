import "./_env";
/**
 * End-to-end check of the wishlist — the intake queue of links to print.
 *
 *   npm run verify:wishlist
 *
 * Drives the real admin form the way a JavaScript-off browser does, and
 * asserts what a person observes: the message the form redirects back
 * with, the database row, the picture cached on the models volume, the
 * thumbnail route and the audit trail. `src/lib/wishlist.ts` is
 * `server-only` so it cannot be imported here — everything goes through
 * HTTP.
 *
 * The refusal table needs no network at all: every guard fires before
 * the first fetch. The happy paths fetch real pages — Wikipedia for the
 * og:title-and-picture case, example.com for the "no picture" case, and
 * a port nothing answers to prove a site that will not cooperate still
 * leaves a row (that one may cost the ten-second timeout).
 *
 * DESTRUCTIVE: wipes wishlist items, their cached thumbnails and the
 * wishlist's audit events. Development database only.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { db } from "../src/lib/db";
import {
  ensureAdmin,
  ensureCredentials,
  signInWithPassword,
  usernameFor,
} from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
/** The host side of the container's models volume, where thumbs land. */
const MODELS_ROOT = resolve(process.env.MODELS_ROOT ?? "/uploads");
const THUMBS = join(MODELS_ROOT, "thumbs");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.info(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  ok ? passed++ : failures.push(name);
}
const section = (t: string) =>
  console.info(`\n── ${t} ${"─".repeat(Math.max(0, 54 - t.length))}`);

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

class Browser {
  jar = new Map<string, string>();
  private store(r: Response) {
    for (const line of r.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i).trim();
      const v = pair!.slice(i + 1).trim();
      if (!v || line.includes("Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { origin: APP };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return h;
  }
  async raw(url: string, init: RequestInit = {}) {
    const r = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), ...this.headers() } });
    this.store(r);
    return r;
  }
  async go(url: string, init: RequestInit = {}) {
    let r = await this.raw(url, init);
    for (let i = 0; i < 8; i++) {
      const loc = r.headers.get("location");
      if (!loc || r.status < 300 || r.status >= 400) break;
      r = await this.raw(new URL(loc, url).toString());
    }
    return r;
  }
  /** Replay one server-action form (its hidden inputs + overrides). */
  async submit(url: string, html: string, formIndex: number, values: Record<string, string>) {
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    const form = forms[formIndex];
    if (!form) throw new Error(`no form #${formIndex} on ${url}`);
    const body = new FormData();
    for (const tag of form.match(/<input\b[^>]*>/g) ?? []) {
      if (!tag.includes('type="hidden"')) continue;
      const n = /name="([^"]*)"/.exec(tag)?.[1];
      const v = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
      if (n) body.append(unescapeHtml(n), unescapeHtml(v));
    }
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    return this.raw(url, { method: "POST", body });
  }
}

/** Index of the first form whose markup contains every substring. */
function findForm(html: string, contains: string[]): number {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.findIndex((f) => contains.every((s) => f.includes(s)));
}

/** The message the form redirects back with, or null if it went elsewhere. */
function flash(res: Response, kind: "error" | "toast"): string | null {
  const loc = res.headers.get("location");
  if (!loc || !loc.includes("?")) return null;
  return new URLSearchParams(loc.slice(loc.indexOf("?") + 1)).get(kind);
}

/** POST the add form, fresh from the screen, the way a browser would. */
async function addWishForm(admin: Browser, url: string, note = ""): Promise<Response> {
  const page = await (await admin.go(`${APP}/admin/wishlist`)).text();
  return admin.submit(`${APP}/admin/wishlist`, page, findForm(page, ['name="url"']), { url, note });
}

/** Audit `detail` is JSON on the wire; read the fields this suite asserts on. */
function auditDetail(row: { detail?: unknown }): { title?: string; url?: string } {
  return (row.detail ?? {}) as { title?: string; url?: string };
}

async function signIn(user: { id: string; email: string }): Promise<Browser> {
  const b = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await signInWithPassword(b, APP, usernameFor(user.email));
  return b;
}

async function main() {
  section("setup");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await db.auditEvent.deleteMany();
  await db.wishlistItem.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany({ where: { role: "user" } });
  // Thumbnails are derived state — the row is the source of truth, and
  // this suite asserts exact directory contents, so it owns the directory.
  rmSync(THUMBS, { recursive: true, force: true });

  const admin = await ensureAdmin(APP);
  if (!admin) throw new Error("No admin — run npm run db:seed");
  const ayla = await db.user.create({
    data: { email: "ayla@office.example", name: "Ayla Berg", initials: "AY", role: "user", emailVerified: true, invitedById: admin.id },
  });

  const ruben = await signIn(admin);
  const client = await signIn(ayla);
  console.info(`  admin=${admin.email}  client=${ayla.email}`);

  // ------------------------------------------------------------------
  section("the wishlist screen is owner-only");
  const denied = await client.go(`${APP}/admin/wishlist`);
  check("a client gets 404, not 403", denied.status === 404, `status ${denied.status}`);
  const adminPage = await (await ruben.go(`${APP}/admin/wishlist`)).text();
  check("the owner sees the board and the add form",
        adminPage.includes("Wants and maybes") && adminPage.includes('name="url"'));

  // ------------------------------------------------------------------
  section("the guards refuse before anything is fetched");
  // [what it is, the link, the exact refusal] — every row below is decided
  // by the URL alone, before a single byte leaves the machine.
  const REFUSALS: [string, string, string][] = [
    ["a plain http link", "http://example.com/",
      "Only an https link, please — the fetch is the one thing that runs on the server's network."],
    ["an https link with nothing after it", "https://", "That does not look like a link."],
    ["a link with spaces in it", "https://not a url", "That does not look like a link."],
    ["a link with an embedded password", "https://user:pass@example.com/",
      "That link embeds credentials — paste the plain public page instead."],
    ["a link with a username only", "https://user@example.com/",
      "That link embeds credentials — paste the plain public page instead."],
    ["localhost", "https://localhost/", "That link points at this machine, not at a shop."],
    ["a *.localhost subdomain", "https://app.localhost/", "That link points at this machine, not at a shop."],
    ["a .local name", "https://printer.local/", "That is an internal name — the app only fetches public sites."],
    ["a .internal name", "https://nas.internal/", "That is an internal name — the app only fetches public sites."],
    ["a .home.arpa name", "https://router.home.arpa/", "That is an internal name — the app only fetches public sites."],
    ["a bare compose label", "https://db/", "That is not a public hostname."],
    ["another bare compose label", "https://app/", "That is not a public hostname."],
    ["the IPv6 loopback", "https://[::1]/", "That is not a public hostname."],
    ["a public IPv6 literal", "https://[2001:db8::1]/", "That is not a public hostname."],
    ["the IPv4 loopback", "https://127.0.0.1/", "That link points at a private address — the app only fetches public sites."],
    ["a 10/8 address", "https://10.0.0.5/", "That link points at a private address — the app only fetches public sites."],
    ["a 172.16/12 address", "https://172.16.0.1/", "That link points at a private address — the app only fetches public sites."],
    ["a 192.168/16 address", "https://192.168.1.1/", "That link points at a private address — the app only fetches public sites."],
    ["a link-local address", "https://169.254.169.254/", "That link points at a private address — the app only fetches public sites."],
    ["a CGNAT address", "https://100.64.0.1/", "That link points at a private address — the app only fetches public sites."],
    ["the unspecified address", "https://0.0.0.0/", "That link points at a private address — the app only fetches public sites."],
    ["a multicast address", "https://224.0.0.1/", "That link points at a private address — the app only fetches public sites."],
  ];
  for (const [label, url, refusal] of REFUSALS) {
    const res = await addWishForm(ruben, url);
    const shown = flash(res, "error");
    check(`refuses ${label}`, shown === refusal, `shown ${shown ?? res.status}`);
  }
  // The schema's own two refusals, which fire before the host is parsed.
  const tooLong = await addWishForm(ruben, `https://${"x".repeat(600)}`);
  check("refuses a link longer than links get",
        flash(tooLong, "error") === "That link is longer than links get.",
        `shown ${flash(tooLong, "error") ?? tooLong.status}`);
  const tooLongNote = await addWishForm(ruben, "https://example.com/", "x".repeat(281));
  check("refuses a note longer than a whisper",
        flash(tooLongNote, "error") === "Keep the note under 280 characters — it is a whisper on the list, not a letter.",
        `shown ${flash(tooLongNote, "error") ?? tooLongNote.status}`);

  check("no refusal created a wish", (await db.wishlistItem.count()) === 0,
        `${await db.wishlistItem.count()} rows`);
  check("and no refusal was audited",
        (await db.auditEvent.count({ where: { action: { startsWith: "wishlist." } } })) === 0);

  // ------------------------------------------------------------------
  section("a public page is fetched once, and its picture cached");
  const WIKI_URL = "https://en.wikipedia.org/wiki/3D_printing";
  const added = await addWishForm(ruben, WIKI_URL);
  check("the add redirects back with a toast", (flash(added, "toast") ?? "").includes("is on the list"),
        `location ${added.headers.get("location") ?? added.status}`);
  const wish = await db.wishlistItem.findUnique({ where: { url: WIKI_URL } });
  check("the wish is stored", !!wish);
  check("the page's og:title becomes the title", wish?.title === "3D printing - Wikipedia", wish?.title ?? "");
  check("an unknown host is its own source", wish?.source === "en.wikipedia.org", wish?.source ?? "");
  // The extension the fetcher picked must be one the thumbnail route can
  // serve back, and the route must serve exactly that type.
  const EXT_MIME: Record<string, string> = {
    jpg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", avif: "image/avif",
  };
  const ext = wish?.thumbnailKey?.split(".").pop() ?? "";
  check("the thumbnail is cached under thumbs/ as a known image type",
        !!wish?.thumbnailKey && wish.thumbnailKey.startsWith("thumbs/") && ext in EXT_MIME,
        wish?.thumbnailKey ?? "null");

  const thumbPath = wish?.thumbnailKey ? join(MODELS_ROOT, wish.thumbnailKey) : "";
  const monthDir = wish?.thumbnailKey ? dirname(thumbPath) : "";
  /** The files in the thumbnail's month directory; [] when there is none. */
  const storedThumbs = () => {
    try { return monthDir ? readdirSync(monthDir) : []; } catch { return []; }
  };
  const diskSize = () => {
    try { return thumbPath ? statSync(thumbPath).size : -1; } catch { return -1; }
  };
  check("the cached picture really is on the models volume", diskSize() > 0, thumbPath);
  check("the atomic write left exactly one file, no temp",
        storedThumbs().length === 1 && storedThumbs().every((f) => !f.includes("tmp-")),
        storedThumbs().join(", "));

  const afterAdd = await (await ruben.go(
    new URL(added.headers.get("location") ?? `${APP}/admin/wishlist`, APP).toString(),
  )).text();
  check("the toast names the wish", afterAdd.includes("is on the list"));

  const board = await (await ruben.go(`${APP}/admin/wishlist`)).text();
  check("the board links to the shop page", board.includes(`href="${WIKI_URL}"`));
  check("the board shows the cached thumbnail", board.includes(`/api/wishlist/${wish!.id}/thumb`));
  check("the board names who added it", board.includes(`added by ${admin.name}`));
  check("the source badge falls back to the hostname", board.includes("en.wikipedia.org"));

  const addedEvents = await db.auditEvent.findMany({ where: { action: "wishlist.added" }, orderBy: { at: "asc" } });
  check("adding is audited", addedEvents.length === 1, `${addedEvents.length} rows`);
  check("the audit row names the actor and the subject",
        addedEvents[0]?.actorEmail === admin.email && addedEvents[0]?.subject === "en.wikipedia.org",
        `${addedEvents[0]?.actorEmail ?? "?"} / ${addedEvents[0]?.subject ?? "?"}`);
  check("the audit detail keeps the title and the url",
        auditDetail(addedEvents[0] ?? {}).title === "3D printing - Wikipedia" &&
          auditDetail(addedEvents[0] ?? {}).url === WIKI_URL,
        JSON.stringify(addedEvents[0]?.detail));

  // ------------------------------------------------------------------
  section("the thumbnail route serves the cached copy, to signed-in people only");
  const thumb = await client.raw(`${APP}/api/wishlist/${wish!.id}/thumb`);
  check("a signed-in person gets the picture", thumb.status === 200, `status ${thumb.status}`);
  check("served as the image its name says it is",
        (thumb.headers.get("content-type") ?? "") === EXT_MIME[ext],
        `header ${thumb.headers.get("content-type")} vs key ...${ext}`);
  check("with the length of the file on disk",
        thumb.headers.get("content-length") === String(diskSize()),
        `header ${thumb.headers.get("content-length")} vs disk ${diskSize()}`);
  check("and marked private, nosniff",
        (thumb.headers.get("cache-control") ?? "").startsWith("private") &&
          thumb.headers.get("x-content-type-options") === "nosniff",
        `${thumb.headers.get("cache-control")} / ${thumb.headers.get("x-content-type-options")}`);
  const stranger = await new Browser().raw(`${APP}/api/wishlist/${wish!.id}/thumb`);
  check("a stranger gets 401, not the picture", stranger.status === 401, `status ${stranger.status}`);
  const absent = await client.raw(`${APP}/api/wishlist/not-a-wish/thumb`);
  check("a wish that is not there gets 404", absent.status === 404, `status ${absent.status}`);

  // ------------------------------------------------------------------
  section("a duplicate is one row, and its orphaned picture is cleaned up");
  const again = await addWishForm(ruben, WIKI_URL, "a second copy");
  check("the repeat is refused as a duplicate",
        flash(again, "error") === "That one is already on the list.",
        `shown ${flash(again, "error") ?? again.status}`);
  check("and no second row appears", (await db.wishlistItem.count({ where: { url: WIKI_URL } })) === 1);
  check("and no second audit row",
        (await db.auditEvent.count({ where: { action: "wishlist.added", subject: "en.wikipedia.org" } })) === 1);
  // The refused add re-fetched the page and re-cached a picture; the P2002
  // handler must have removed that orphan, not left bytes with no row.
  check("and the re-fetched thumbnail was cleaned up, not orphaned",
        storedThumbs().length === 1, storedThumbs().join(", "));

  // ------------------------------------------------------------------
  section("a page with no picture is still a wish");
  const PLAIN_URL = "https://example.com/";
  const plain = await addWishForm(ruben, PLAIN_URL, "for the cable tray, maybe");
  check("the add succeeds without a picture", (flash(plain, "toast") ?? "").includes("is on the list"),
        `location ${plain.headers.get("location") ?? plain.status}`);
  const bare = await db.wishlistItem.findUnique({ where: { url: PLAIN_URL } });
  check("the title falls back to the page's <title>", bare?.title === "Example Domain", bare?.title ?? "");
  check("and no thumbnail was cached", bare?.thumbnailKey == null, String(bare?.thumbnailKey));
  check("the note is kept", bare?.note === "for the cable tray, maybe", bare?.note ?? "");
  const bareBoard = await (await ruben.go(`${APP}/admin/wishlist`)).text();
  check("the board shows its 'no pic' placeholder", bareBoard.includes("no pic"));
  check("and the note under the link", bareBoard.includes("for the cable tray, maybe"));
  const bareThumb = await client.raw(`${APP}/api/wishlist/${bare!.id}/thumb`);
  check("a wish without a picture has no thumbnail to serve", bareThumb.status === 404, `status ${bareThumb.status}`);

  // ------------------------------------------------------------------
  section("a site that will not cooperate still leaves a row");
  // Port 1 answers nothing; worst case this costs the ten-second timeout.
  const DEAD_URL = "https://example.com:1/some/model-name.stl";
  const dead = await addWishForm(ruben, DEAD_URL);
  check("the add succeeds anyway", (flash(dead, "toast") ?? "").includes("is on the list"),
        `location ${dead.headers.get("location") ?? dead.status}`);
  const slug = await db.wishlistItem.findUnique({ where: { url: DEAD_URL } });
  check("the title falls back to the URL's last segment", slug?.title === "model name", slug?.title ?? "");
  check("and nothing was cached", slug?.thumbnailKey == null, String(slug?.thumbnailKey));

  check("every successful add was audited",
        (await db.auditEvent.count({ where: { action: "wishlist.added" } })) === 3);

  // ------------------------------------------------------------------
  section("taking a wish off the list");
  for (const row of [wish!, bare!, slug!]) {
    const page = await (await ruben.go(`${APP}/admin/wishlist`)).text();
    await ruben.submit(`${APP}/admin/wishlist`, page, findForm(page, [`value="${row.id}"`, 'name="id"']), {});
  }
  check("all three wishes are gone", (await db.wishlistItem.count()) === 0);
  check("and the cached picture with them", !existsSync(thumbPath) && storedThumbs().length === 0);
  const removedEvents = await db.auditEvent.findMany({ where: { action: "wishlist.removed" }, orderBy: { at: "asc" } });
  check("each removal is audited", removedEvents.length === 3, `${removedEvents.length} rows`);
  check("the audit rows name the source and the url",
        removedEvents.every((e) => e.subject != null && auditDetail(e).url != null),
        JSON.stringify(removedEvents.map((e) => [e.subject, auditDetail(e).url])));
  const emptyBoard = await (await ruben.go(`${APP}/admin/wishlist`)).text();
  check("the board says the list is empty", emptyBoard.includes("Nothing on the list yet"));
  // The remove form outlives its row: submitting it again is refused, not re-run.
  const stale = await ruben.submit(`${APP}/admin/wishlist`, board, findForm(board, [`value="${wish!.id}"`, 'name="id"']), {});
  check("removing a gone wish says so",
        flash(stale, "error") === "That wish is already gone.",
        `shown ${flash(stale, "error") ?? stale.status}`);

  // ------------------------------------------------------------------
  section("teardown — the list and its trail are left empty");
  await db.wishlistItem.deleteMany();
  await db.auditEvent.deleteMany({ where: { action: { startsWith: "wishlist." } } });
  rmSync(THUMBS, { recursive: true, force: true });
  check("clear for the next run",
        (await db.wishlistItem.count()) === 0 &&
          (await db.auditEvent.count({ where: { action: { startsWith: "wishlist." } } })) === 0 &&
          !existsSync(THUMBS));

  console.info(
    `\n${passed} checks passed, ${failures.length} failed` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
