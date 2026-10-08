import "./_env";
/**
 * End-to-end check of the settings screen.
 *
 *   npm run build && npm start
 *   npm run verify:settings
 *
 * Drives the real admin forms the way a JavaScript-off browser does, then
 * asserts what a person observes: the stored row, what the app then shows, and
 * what the server accepts or refuses. `src/lib/settings.ts` is `server-only`,
 * so nothing here imports it — every assertion goes through HTTP or the
 * database, exactly as an operator would see it.
 *
 * The suite owns every settings row for the run and deletes them at the end.
 * That matters beyond tidiness: the defaults are what the other suites expect
 * — verify:cost asserts on `$` amounts, and a run of this suite that left the
 * shop in euro would fail it for the wrong reason.
 *
 * DESTRUCTIVE: wipes users, stories, settings. Development database only.
 */
import { db } from "../src/lib/db";
import { ensureAdmin, ensureCredentials, signInWithPassword, usernameFor } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

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

/** The query parameter a redirect carried, decoded. */
function paramOf(location: string | null, name: string): string {
  if (!location) return "";
  try {
    return new URL(location, APP).searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

/**
 * Which option a segmented control is showing as chosen.
 *
 * Read off the rendered `aria-checked`, because that is the property a screen
 * reader announces — the class name is a means and can change under a
 * redesign without anything being wrong.
 */
function chosenIn(html: string, groupLabel: string): string[] {
  const group =
    new RegExp(`aria-label="${groupLabel}"[\\s\\S]{0,2000}?</div>`).exec(html)?.[0] ?? "";
  return [...group.matchAll(/aria-checked="true"[^>]*>([^<]*)</g)].map((m) => m[1]!.trim());
}

/** A real 12-triangle binary STL, so an upload can reach the happy path. */
function stlBox(x: number, y: number, z: number): Uint8Array {
  const p = [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const faces = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],
                 [1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  const tris = faces.map((f) => f.flatMap((i) => p[i]!));
  const buf = new Uint8Array(84 + tris.length * 50);
  const view = new DataView(buf.buffer);
  view.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    for (let i = 0; i < 9; i++) view.setFloat32(off + 12 + i * 4, t[i]!, true);
    off += 50;
  }
  return buf;
}

async function signIn(user: { id: string; email: string }): Promise<Browser> {
  const b = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await signInWithPassword(b, APP, usernameFor(user.email));
  return b;
}

/** Save one section of the settings screen, exactly as its form does. */
async function save(
  client: Browser,
  which: "money" | "orders" | "people" | "identity",
  values: Record<string, string>,
) {
  const page = await (await client.go(`${APP}/admin/settings`)).text();
  const index = findForm(page, ['name="section"', `value="${which}"`]);
  if (index < 0) throw new Error(`no form for the "${which}" section on ${APP}/admin/settings`);
  return client.submit(`${APP}/admin/settings`, page, index, values);
}

/** What the database holds for one key — the stored JSON, as written. */
async function stored(key: string): Promise<string | null> {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
}

/**
 * One upload, as the form posts it. `fields` overrides the defaults, which is
 * how the colour checks below post a colour the form would never offer.
 */
async function upload(
  client: Browser,
  file: Uint8Array,
  name = "part.stl",
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.set("file", new File([file as BlobPart], name));
  form.set("title", "Settings test");
  form.set("material", "PETG");
  form.set("colorName", "Teal");
  form.set("quantity", "1");
  form.set("tip", "A beer");
  form.set("note", "");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return client.raw(`${APP}/api/upload`, { method: "POST", body: form });
}

async function main() {
  section("setup");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await db.setting.deleteMany();
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.story.deleteMany();
  await db.verification.deleteMany();
  await db.session.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany({ where: { role: "user" } });

  const admin = await ensureAdmin(APP);
  if (!admin) throw new Error("No admin — run npm run db:seed");
  const ayla = await db.user.create({
    data: { email: "ayla@office.example", name: "Ayla Berg", initials: "AY",
            role: "user", emailVerified: true, invitedById: admin.id },
  });

  // Two materials in a known order, and the rates the cost is derived from.
  // The rates are the calculator's inputs — verify:cost owns editing them
  // through their screens; here they are fixtures, like the stories below.
  for (const [i, name] of ["PLA", "PETG"].entries()) {
    await db.material.upsert({
      where: { name },
      create: { name, sortOrder: i + 1 },
      update: { sortOrder: i + 1, active: true, },
    });
  }
  await db.materialRate.upsert({
    where: { material: "PETG" },
    create: { material: "PETG", dollarsPerKg: 30 },
    update: { dollarsPerKg: 30 },
  });
  await db.machineRate.upsert({
    where: { id: "default" },
    create: { id: "default", dollarsPerHour: 1.5 },
    update: { dollarsPerHour: 1.5 },
  });

  // 1 kg of PETG (€30) and an hour on the machine (€1.50): a cost of 31.50
  // that every currency and markup assertion below can be read against.
  const story = await db.story.create({
    data: {
      title: "Settings test part", uploaderId: admin.id, status: "Accepted",
      material: "PETG", colorName: "Slate", colorHex: "#4a5d78", tip: "A beer",
      quantity: 1, note: "", filename: "part.stl", fileSize: 1234,
      mimeType: "model/stl", storageKey: "k-settings", dims: "10 × 10 × 10 mm",
      weightGrams: 1000, printMinutes: 60,
    },
  });

  const ruben = await signIn(admin);
  const client = await signIn(ayla);
  console.info(`  admin=${admin.email}  client=${ayla.email}`);

  // ------------------------------------------------------------------
  section("the settings screen is behind the counter");
  const denied = await client.go(`${APP}/admin/settings`);
  check("a member gets 404, not 403", denied.status === 404, `status ${denied.status}`);
  const screen = await (await ruben.go(`${APP}/admin/settings`)).text();
  check("the owner sees the screen", screen.includes("How the shop runs"));
  check("with every section on it",
        ["Money", "New orders", "Guests and invitations", "The sign over the door"]
          .every((t) => screen.includes(t)));
  check("and what this deployment is", screen.includes("This deployment"));

  // ------------------------------------------------------------------
  section("the currency is what every price is written in");
  const euro = await save(ruben, "money", { currency: "EUR", markupPercent: "0", minimumCharge: "0" });
  check("the currency saves through the form",
        paramOf(euro.headers.get("location"), "toast").includes("saved"),
        paramOf(euro.headers.get("location"), "toast") || paramOf(euro.headers.get("location"), "error"));
  check("it is stored as the ISO code", (await stored("currency")) === '"EUR"',
        String(await stored("currency")));

  const audited = await db.auditEvent.findFirst({
    where: { action: "setting.changed", subject: "Currency" },
    orderBy: { at: "desc" },
  });
  const detail = audited?.detail as { from?: unknown; to?: unknown } | null;
  check("the change is audited, with what it was and what it became",
        audited?.actorId === admin.id && detail?.from === "USD" && detail?.to === "EUR",
        JSON.stringify({ actor: audited?.actorId, detail }));

  const storyPage = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  check("a ticket's cost is shown in euro", storyPage.includes("€31.50"),
        storyPage.includes("$31.50") ? "still dollars" : "no €31.50 found");
  check("and the currency is the one on the settings screen",
        !storyPage.includes("$31.50"));
  const queuePage = await (await ruben.go(`${APP}/queue`)).text();
  check("the queue agrees", queuePage.includes("€31.50"), "the queue chip is not in euro");
  check("the rate fields name the currency too",
        (await (await ruben.go(`${APP}/admin/settings/materials`)).text()).includes("€/kg") ||
        (await (await ruben.go(`${APP}/admin/settings/rates`)).text()).includes("€/kg"),
        "neither the materials nor the rates screen says €/kg");

  // ------------------------------------------------------------------
  section("markup and a floor turn a cost into a price");
  await save(ruben, "money", { currency: "EUR", markupPercent: "25", minimumCharge: "0" });
  const marked = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  check("the cost is unchanged", marked.includes("€31.50"));
  check("and the price is the cost plus the markup", marked.includes("€39.38"),
        "expected 31.50 + 25% = 39.38");
  check("the screen says where the number came from", marked.includes("25% on cost"));

  await save(ruben, "money", { currency: "EUR", markupPercent: "25", minimumCharge: "50" });
  const floored = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  check("a minimum charge lifts a small job", floored.includes("€50.00"));
  check("and is labelled as the reason", floored.includes("minimum charge"));

  await save(ruben, "money", { currency: "EUR", markupPercent: "0", minimumCharge: "0" });
  const backToCost = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  check("back at the defaults, the price is the cost and is not shown twice",
        backToCost.includes("€31.50") && !backToCost.includes("Price to charge"));

  // ------------------------------------------------------------------
  section("a bad value is refused, and nothing is written");
  const bogusCurrency = await save(ruben, "money", { currency: "XYZ", markupPercent: "0", minimumCharge: "0" });
  check("a currency off the list is refused",
        paramOf(bogusCurrency.headers.get("location"), "error").includes("Currency"),
        paramOf(bogusCurrency.headers.get("location"), "error"));
  check("and the stored value is untouched", (await stored("currency")) === '"EUR"');

  const tooBig = await save(ruben, "orders", { maxUploadMb: "9999" });
  check("a size above the build's ceiling is refused",
        paramOf(tooBig.headers.get("location"), "error").includes("Largest model"),
        paramOf(tooBig.headers.get("location"), "error"));

  const nowhere = await save(ruben, "money", { section: "nowhere", currency: "EUR" });
  check("a section that is not one of ours is refused",
        paramOf(nowhere.headers.get("location"), "error").length > 0);

  // ------------------------------------------------------------------
  section("the shop can be closed, and the server agrees");
  const PAUSED = "Away until Monday — back on the 14th.";
  await save(ruben, "orders", {
    ordersPaused: "on",
    pausedMessage: PAUSED,
    defaultMaterial: "",
    maxUploadMb: "250",
  });
  check("pausing saves", (await stored("ordersPaused")) === "true", String(await stored("ordersPaused")));

  const pausedPage = await (await client.go(`${APP}/upload`)).text();
  check("the upload page says why, in the owner's words", pausedPage.includes(PAUSED));
  check("and offers nothing to fill in", !pausedPage.includes('id="title"'));

  const refused = await upload(client, stlBox(20, 20, 20));
  check("the endpoint refuses an upload while paused (503)", refused.status === 503, `status ${refused.status}`);
  check("with the owner's own sentence",
        ((await refused.json()) as { error?: string }).error === PAUSED);

  await save(ruben, "orders", {
    pausedMessage: PAUSED,
    defaultMaterial: "",
    maxUploadMb: "250",
  });
  check("unpausing is the same form with the box cleared", (await stored("ordersPaused")) === "false",
        String(await stored("ordersPaused")));
  const resumed = await upload(client, stlBox(20, 20, 20));
  check("and uploads work again", resumed.status === 200, `status ${resumed.status}`);

  // ------------------------------------------------------------------
  section("the upload form starts on the material the owner chose");
  let form = await (await client.go(`${APP}/upload`)).text();
  check("with no default, it starts on the first material on the list",
        chosenIn(form, "Material").join() === "PLA", chosenIn(form, "Material").join());

  await save(ruben, "orders", { pausedMessage: PAUSED, defaultMaterial: "PETG", maxUploadMb: "250" });
  form = await (await client.go(`${APP}/upload`)).text();
  check("the default is the one selected", chosenIn(form, "Material").join() === "PETG",
        chosenIn(form, "Material").join());

  await save(ruben, "orders", { pausedMessage: PAUSED, defaultMaterial: "PLA", maxUploadMb: "10" });
  form = await (await client.go(`${APP}/upload`)).text();
  check("and a smaller cap is what the form states", form.includes("10.0 MB max"),
        "the dropzone does not show the owner's cap");
  const big = await upload(client, new Uint8Array(11 * 1024 * 1024));
  check("a file over the owner's cap is refused (413)", big.status === 413, `status ${big.status}`);
  check("naming the owner's limit, not the build's",
        ((await big.json()) as { error?: string }).error?.includes("10.0 MB") === true,
        "the refusal quotes a limit that is not the one refusing it");

  // A default that has since been retired falls back rather than posting a
  // material the server would refuse.
  await save(ruben, "orders", { pausedMessage: PAUSED, defaultMaterial: "PLA", maxUploadMb: "250" });
  await db.material.update({ where: { name: "PLA" }, data: { active: false } });
  form = await (await client.go(`${APP}/upload`)).text();
  check("a retired default falls back to the first live material",
        chosenIn(form, "Material").join() === "PETG", chosenIn(form, "Material").join());
  await db.material.update({ where: { name: "PLA" }, data: { active: true } });

  // ------------------------------------------------------------------
  section("an invitation's lifetime is a setting");
  await save(ruben, "people", { inviteExpiryDays: "3" });
  check("the days are stored", (await stored("inviteExpiryDays")) === "3", String(await stored("inviteExpiryDays")));
  const guestList = await (await ruben.go(`${APP}/admin/invites`)).text();
  check("and the guest list says so", guestList.includes("expire after 3 days"),
        "the guest list still claims a different lifetime");

  // ------------------------------------------------------------------
  section("what the team is called");
  await save(ruben, "identity", { teamName: "Werkstatt" });
  const namedQueue = await (await ruben.go(`${APP}/queue`)).text();
  check("the queue is named after it", namedQueue.includes("Werkstatt"));
  const namedUpload = await (await client.go(`${APP}/upload`)).text();
  check("and so is the invitation to send work in", namedUpload.includes("Werkstatt"));

  // ------------------------------------------------------------------
  section("each material's colours are the owner's to set");

  const colorsDenied = await client.go(`${APP}/admin/settings/colors`);
  check("a member gets 404 on the colour list", colorsDenied.status === 404,
        `status ${colorsDenied.status}`);

  let colors = await (await ruben.go(`${APP}/admin/settings/colors`)).text();
  check("the owner sees one block per material",
        colors.includes("What each material comes in") &&
          ["PLA", "PETG"].every((name) => colors.includes(name)));

  // A shade nobody stocks and no compile-time list knows, so nothing below can
  // pass on a name the app already had.
  const COLOR = "Aurora";
  const HEX = "#ff00aa";

  const addColor = findForm(colors, ['name="material"', 'value="PETG"', 'name="hex"']);
  if (addColor < 0) throw new Error(`no add-a-colour form for PETG on ${APP}/admin/settings/colors`);
  const colourAdded = await ruben.submit(`${APP}/admin/settings/colors`, colors, addColor, {
    name: COLOR,
    hex: HEX,
  });
  check("adding a colour saves through the form",
        paramOf(colourAdded.headers.get("location"), "toast").includes(COLOR),
        paramOf(colourAdded.headers.get("location"), "toast") ||
          paramOf(colourAdded.headers.get("location"), "error"));

  const colourRow = await db.materialColor.findFirst({ where: { material: "PETG", name: COLOR } });
  check("it lands on PETG's list with the hex that was typed",
        colourRow?.hex === HEX && colourRow?.active === true, JSON.stringify(colourRow));
  const colourAudit = await db.auditEvent.findFirst({
    where: { action: "color.created" },
    orderBy: { at: "desc" },
  });
  check("and the change is audited against the admin",
        colourAudit?.actorId === admin.id && (colourAudit?.subject ?? "").includes(COLOR),
        JSON.stringify({ actor: colourAudit?.actorId, subject: colourAudit?.subject }));

  form = await (await ruben.go(`${APP}/upload`)).text();
  check("the upload form now offers it for PETG",
        form.includes(COLOR) && form.includes(HEX),
        "the new swatch is not on the form");

  // The form can only hide a colour; the route has to refuse one. Posted
  // straight at the endpoint, with no form in the way.
  const offList = await upload(client, stlBox(20, 20, 20), "off-list.stl", {
    colorName: "Magenta",
  });
  check("a colour off that material's list is refused (400)", offList.status === 400,
        `status ${offList.status}`);
  check("and the refusal says so",
        ((await offList.json()) as { error?: string }).error?.includes("is not on offer in") === true,
        "the endpoint accepted a colour nobody stocks");

  // The two-colour case is the one the extra swatches exist for: the ticket has
  // to keep both the primary and each extra exactly as they were asked for.
  const swatched = await upload(client, stlBox(20, 20, 20), "aurora.stl", {
    colorName: COLOR,
    additionalColorNames: "Bone white",
  });
  check("a colour on the list uploads", swatched.status === 200, `status ${swatched.status}`);
  const swatchedId = ((await swatched.json()) as { id: number }).id;
  const swatchedStory = await db.story.findUnique({ where: { id: swatchedId } });
  check("and the ticket records the swatch it was asked for",
        swatchedStory?.colorName === COLOR && swatchedStory?.colorHex === HEX,
        JSON.stringify({ name: swatchedStory?.colorName, hex: swatchedStory?.colorHex }));
  const extraStored = (swatchedStory?.additionalColors ?? []) as Array<{ name: string; hex: string }>;
  check("including the extra colour's own swatch",
        extraStored.length === 1 && extraStored[0]?.name === "Bone white" &&
          extraStored[0]?.hex === "#eaecee",
        JSON.stringify(swatchedStory?.additionalColors));

  // Retire it: off the form, and nothing a past ticket says changes.
  colors = await (await ruben.go(`${APP}/admin/settings/colors`)).text();
  const retireColor = colourRow
    ? findForm(colors, ['name="active"', 'value="false"', `value="${colourRow.id}"`])
    : -1;
  const colourRetired = retireColor >= 0
    ? await ruben.submit(`${APP}/admin/settings/colors`, colors, retireColor, {})
    : null;
  check("retiring it saves through the form",
        colourRetired !== null &&
          paramOf(colourRetired.headers.get("location"), "toast").length > 0,
        paramOf(colourRetired?.headers.get("location") ?? null, "error"));
  check("and is audited",
        (await db.auditEvent.findFirst({
          where: { action: "color.retired" },
          orderBy: { at: "desc" },
        }))?.actorId === admin.id);

  const afterRetire = await (await ruben.go(`${APP}/upload`)).text();
  check("the form no longer offers it", !afterRetire.includes(HEX),
        "a retired colour is still on the form");
  const stillAsking = await db.story.findUnique({ where: { id: swatchedId } });
  check("but the ticket still asks for it",
        stillAsking?.colorName === COLOR && stillAsking?.colorHex === HEX,
        JSON.stringify({ name: stillAsking?.colorName, hex: stillAsking?.colorHex }));

  // ------------------------------------------------------------------
  section("teardown — back to the defaults");
  await db.setting.deleteMany();
  const defaulted = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  check("every setting row is gone", (await db.setting.count()) === 0);
  check("so prices read as the build's default currency again",
        defaulted.includes("$31.50"), "the page is not back in dollars");
  check("and the queue is the print team again",
        !(await (await ruben.go(`${APP}/queue`)).text()).includes("Werkstatt"));
  // The colour this suite added is the one thing it must take away itself: a
  // leftover row would change what the upload form offers for every later run.
  await db.materialColor.deleteMany({ where: { name: COLOR } });
  check("the colour this suite added is gone",
        (await db.materialColor.count({ where: { name: COLOR } })) === 0);

  console.info(
    `\n${passed} checks passed, ${failures.length} failed` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
