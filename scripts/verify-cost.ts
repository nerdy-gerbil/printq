import "./_env";
/**
 * End-to-end check of the cost ledger: the weigh-in, the cost derived
 * from it, and the wall that keeps the numbers off the API wire.
 *
 *   npm run verify:cost
 *
 * The ledger is two measured numbers — filament weighed in grams,
 * minutes on the bed — and a cost derived at render from the current
 * rates, never stored and never estimated. This drives the real
 * forms: the rate screens, the ledger form on a ticket, the queue
 * chip — and then asserts the one thing that must never happen, the
 * numbers reaching the JSON API.
 *
 * DESTRUCTIVE: wipes users, stories and the cost rates. Development
 * database only.
 */
import { db } from "../src/lib/db";
import { storyRef } from "../src/lib/scope";
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
    const r = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...this.headers() },
    });
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
  /** Replays a server-action form the way a JS-less browser does. */
  async submit(url: string, html: string, formIndex: number, values: Record<string, string>) {
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    const form = forms[formIndex];
    if (!form) throw new Error(`no form #${formIndex} on ${url}`);
    const body = new FormData();
    for (const tag of form.match(/<input\b[^>]*>/g) ?? []) {
      if (!tag.includes('type="hidden"')) continue;
      const n = /name="([^\"]*)"/.exec(tag)?.[1];
      const v = /value="([^\"]*)"/.exec(tag)?.[1] ?? "";
      if (n) body.append(unescapeHtml(n), unescapeHtml(v));
    }
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    return this.raw(url, { method: "POST", body });
  }
}
/**
 * React SSR puts an empty comment between static text and an
 * interpolation, so "offers {tip}" reaches the wire as "offers
 * <!-- -->A beer". Asserting on the raw markup therefore fails on
 * copy that is perfectly correct.
 */
const rendered = (html: string) => html.replace(/<!--\s*-->/g, "");

/** Reads one parameter out of a Location header, with form decoding. */
function paramOf(location: string | null, key: string): string {
  if (!location) return "";
  const q = location.split("?")[1] ?? "";
  return new URLSearchParams(q).get(key) ?? "";
}

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * A signed-in browser for an existing user row.
 *
 * Takes the id as well as the address because a password is set against
 * the account, not the mailbox: `ensureCredentials` gives the row a
 * username and a password through the app's own reset endpoint, and the
 * sign-in below is the same request the sign-in form makes. `verify:auth`
 * owns the real registration path; this is the short way to a session.
 */
async function signIn(user: { id: string; email: string }): Promise<Browser> {
  const b = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await signInWithPassword(b, APP, usernameFor(user.email));
  return b;
}

/** Finds the index of the form whose markup contains a marker. */
function formIndexContaining(html: string, marker: string): number {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.findIndex((f) => f.includes(marker));
}

async function makeStory(uploaderId: string, title: string, status = "Requested") {
  return db.story.create({
    data: {
      title, status: status as never, uploaderId,
      material: "PETG", colorName: "Slate", colorHex: "#4a5d78", tip: "A beer",
      quantity: 1, note: "", filename: "part.stl", fileSize: 1234,
      mimeType: "model/stl", storageKey: `k-${title}`, dims: "10 × 10 × 10 mm",
    },
  });
}

/** Every key of a JSON value, at every depth — a leak hides nested. */
const keysOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value != null && typeof value === "object") {
    return [...Object.keys(value), ...Object.values(value).flatMap(keysOf)];
  }
  return [];
};

/**
 * The ledger's own fields, and the derived figures built from them.
 * `storyResource` names its fields, so none of these can appear on the
 * API wire by accident — only by a deliberate, wrong decision. The
 * list doubles as the tripwire for that decision.
 */
const OFF_WIRE = [
  "weightGrams", "printMinutes",
  "dollarsPerKg", "dollarsPerHour",
  "cost", "filament", "machine", "total",
];

async function main() {
  section("setup");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.story.deleteMany();
  await db.verification.deleteMany();
  await db.session.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany({ where: { role: "user" } });
  // The rates are the calculator's inputs, so the suite owns them for
  // the run and sets both through the admin screens below. The
  // materials themselves are reference data: the migration seeds the
  // four defaults, and a rate is keyed by material name rather than
  // foreign-keyed, so the rows are independent. PETG is on the list in
  // any migrated database — the suite only needs it to exist.
  await db.materialRate.deleteMany();
  await db.machineRate.deleteMany();
  if (!(await db.material.findUnique({ where: { name: "PETG" } }))) {
    await db.material.create({ data: { name: "PETG" } });
  }

  const admin = await ensureAdmin(APP);
  if (!admin) throw new Error("No admin — run npm run db:seed");
  const ayla = await db.user.create({
    data: { email: "ayla@office.example", name: "Ayla Berg", initials: "AY",
            role: "user", emailVerified: true, invitedById: admin.id },
  });

  const ruben = await signIn(admin);
  const client = await signIn(ayla);
  console.info(`  admin=${admin.email}  client=${ayla.email}`);

  // ------------------------------------------------------------------
  section("the rates are owner-managed, set through the screens");

  const materialsPage = await (await ruben.go(`${APP}/admin/materials`)).text();
  const petgRateIdx = formIndexContaining(materialsPage, 'name="dollarsPerKg"');
  check("PETG is on the list with a price control", petgRateIdx >= 0);
  const priced = await ruben.submit(`${APP}/admin/materials`, materialsPage, petgRateIdx, {
    dollarsPerKg: "30",
  });
  check("the $/kg is saved through the form",
        paramOf(priced.headers.get("location"), "toast").includes("Rate saved for"),
        paramOf(priced.headers.get("location"), "toast"));
  const kgAudit = await db.auditEvent.findFirst({
    where: { action: "material.rate_changed", subject: "PETG" },
    orderBy: { at: "desc" },
  });
  const kgDetail = kgAudit?.detail as { from?: number | null; to?: number } | null;
  check("the price change is audited from nothing",
        kgAudit?.actorId === admin.id && kgDetail?.from === null && kgDetail?.to === 30,
        JSON.stringify(kgAudit?.detail));

  const ratesPage = await (await ruben.go(`${APP}/admin/rates`)).text();
  const machineIdx = formIndexContaining(ratesPage, 'id="machine-rate"');
  check("the machine rate has its form", machineIdx >= 0);
  const hourly = await ruben.submit(`${APP}/admin/rates`, ratesPage, machineIdx, {
    dollarsPerHour: "1.50",
  });
  check("the $/hour is saved through the form",
        paramOf(hourly.headers.get("location"), "toast").includes("Machine rate saved"),
        paramOf(hourly.headers.get("location"), "toast"));
  const hourAudit = await db.auditEvent.findFirst({
    where: { action: "machine.rate_changed" },
    orderBy: { at: "desc" },
  });
  const hourDetail = hourAudit?.detail as { from?: number | null; to?: number } | null;
  check("and audited from nothing",
        hourAudit?.actorId === admin.id && hourDetail?.from === null && hourDetail?.to === 1.5,
        JSON.stringify(hourAudit?.detail));
  const ratesAfter = rendered(await (await ruben.go(`${APP}/admin/rates`)).text());
  check("the rates screen reads the material price back",
        ratesAfter.includes("$30.00 / kg"), ratesAfter.slice(0, 400));

  // ------------------------------------------------------------------
  section("the ledger is the team's, and only the team's");

  const denied = await client.go(`${APP}/queue`);
  check("a client gets 404 on the queue", denied.status === 404, `status ${denied.status}`);

  const story = await makeStory(ayla.id, "Monitor-arm hook, weighed");
  const clientPage = rendered(await (await client.go(`${APP}/story/${story.id}`)).text());
  check("the requester sees their own ticket",
        clientPage.includes("Monitor-arm hook, weighed"));
  check("but no ledger section", !clientPage.includes("The ledger"),
        "what a print costs the team is not the requester's business");
  check("and no ledger form", !clientPage.includes("Cost ledger"));

  const teamPage = rendered(await (await ruben.go(`${APP}/story/${story.id}`)).text());
  check("the team's page carries the ledger", teamPage.includes("The ledger"));
  check("with the form behind it", teamPage.includes("Cost ledger"));
  check("and reads empty before any weigh-in",
        teamPage.includes("No measurements recorded yet"));
  check("saying which rates a recording would be derived at",
        teamPage.includes("30.00 $/kg + 1.50 $/hour"),
        "the empty ledger should name the current rates");
  check("the form says the same",
        teamPage.includes("Cost is derived at 30.00 $/kg and 1.50 $/hour"));

  // ------------------------------------------------------------------
  section("recording a weigh-in through the ledger form");

  let page = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  const ledgerIdx = formIndexContaining(page, 'name="weightGrams"');
  check("the ticket carries the ledger form", ledgerIdx >= 0);
  const recorded = await ruben.submit(`${APP}/story/${story.id}`, page, ledgerIdx, {
    weightGrams: "120",
    printMinutes: "90",
  });
  check("recording redirects with the toast",
        paramOf(recorded.headers.get("location"), "toast") ===
          `Cost recorded for ${storyRef(story.id)}.`,
        paramOf(recorded.headers.get("location"), "toast"));

  let row = await db.story.findUnique({ where: { id: story.id } });
  check("the weigh-in is stored on the ticket",
        row?.weightGrams === 120 && row?.printMinutes === 90,
        JSON.stringify({ g: row?.weightGrams, min: row?.printMinutes }));

  const costed = await db.auditEvent.findFirst({
    where: { action: "story.costed", subject: storyRef(story.id) },
  });
  const costedDetail = costed?.detail as
    { title?: string; weightGrams?: number | null; printMinutes?: number | null } | null;
  check("and audited with the numbers, by the admin",
        costed?.actorId === admin.id &&
          costedDetail?.title === story.title &&
          costedDetail?.weightGrams === 120 &&
          costedDetail?.printMinutes === 90,
        JSON.stringify(costed?.detail));

  page = rendered(await (await ruben.go(`${APP}/story/${story.id}`)).text());
  check("the ledger shows what it recorded",
        page.includes("Recorded: 120 g · 1 h 30 m"));

  // ------------------------------------------------------------------
  section("the cost derives at the current rates");

  // 120 g at $30/kg is $3.60 of filament; 90 min at $1.50/h is $2.25
  // of machine time; the cost to the team is the sum, $5.85.
  check("filament is weighed and priced", page.includes("120 g · $3.60"));
  check("machine time is noted and priced", page.includes("1 h 30 m · $2.25"));
  check("the cost to the team is the sum", page.includes("$5.85"));

  await db.story.update({ where: { id: story.id }, data: { status: "Accepted" } });
  const queue = rendered(await (await ruben.go(`${APP}/queue`)).text());
  check("a working ticket carries its cost on the queue", queue.includes("$5.85"));
  check("with the working in its tooltip",
        queue.includes("$3.60 filament + $2.25 machine"));

  // ------------------------------------------------------------------
  section("a rate change re-derives tickets already costed");

  // Nothing is snapshotted: both inputs are live. PETG goes $30 -> $60
  // and the machine $1.50 -> $3.00, so the same weigh-in now reads
  // $7.20 of filament + $4.50 of machine time = $11.70.
  const materialsAgain = await (await ruben.go(`${APP}/admin/materials`)).text();
  const repriced = await ruben.submit(`${APP}/admin/materials`, materialsAgain,
    formIndexContaining(materialsAgain, 'name="dollarsPerKg"'), { dollarsPerKg: "60" });
  check("the material price moves through the form",
        paramOf(repriced.headers.get("location"), "toast").includes("Rate saved for"),
        paramOf(repriced.headers.get("location"), "toast"));

  const ratesAgain = await (await ruben.go(`${APP}/admin/rates`)).text();
  const rehour = await ruben.submit(`${APP}/admin/rates`, ratesAgain,
    formIndexContaining(ratesAgain, 'id="machine-rate"'), { dollarsPerHour: "3.00" });
  check("and so does the machine rate",
        paramOf(rehour.headers.get("location"), "toast").includes("Machine rate saved"),
        paramOf(rehour.headers.get("location"), "toast"));

  const kgAgain = await db.auditEvent.findFirst({
    where: { action: "material.rate_changed", subject: "PETG" },
    orderBy: { at: "desc" },
  });
  const kgAgainDetail = kgAgain?.detail as { from?: number | null; to?: number } | null;
  check("the price change is audited from the old price",
        kgAgainDetail?.from === 30 && kgAgainDetail?.to === 60,
        JSON.stringify(kgAgain?.detail));
  const hourAgain = await db.auditEvent.findFirst({
    where: { action: "machine.rate_changed" },
    orderBy: { at: "desc" },
  });
  const hourAgainDetail = hourAgain?.detail as { from?: number | null; to?: number } | null;
  check("as is the machine rate's",
        hourAgainDetail?.from === 1.5 && hourAgainDetail?.to === 3,
        JSON.stringify(hourAgain?.detail));

  page = rendered(await (await ruben.go(`${APP}/story/${story.id}`)).text());
  check("the same weigh-in now reads $7.20 of filament",
        page.includes("120 g · $7.20"));
  check("$4.50 of machine time", page.includes("1 h 30 m · $4.50"));
  check("and $11.70 for the team", page.includes("$11.70"),
        "the cost looked snapshotted, not derived from the current rates");

  const queueAgain = rendered(await (await ruben.go(`${APP}/queue`)).text());
  check("and the queue chip re-derives with them",
        queueAgain.includes("$11.70") && queueAgain.includes("$7.20 filament + $4.50 machine"));

  // ------------------------------------------------------------------
  section("none of it reaches the API wire");

  // The measurements exist and the cost is live ($11.70) — the worst
  // case for a leak. The payload is walked whole, nested included, so
  // nothing can smuggle a ledger field in under a new name's parent.
  const wire = await ruben.raw(`${APP}/api/stories/${story.id}`);
  const body = await wire.text();
  check("the API serves the ticket to the team", wire.status === 200, `status ${wire.status}`);

  const parsed: unknown = JSON.parse(body);
  const resource = parsed as { id?: number; ref?: string; title?: string; status?: string };
  check("and the ticket itself is all there",
        resource.id === story.id && resource.ref === storyRef(story.id) &&
          resource.title === story.title && resource.status === "Accepted");

  const onWire = keysOf(parsed).filter((k) => OFF_WIRE.includes(k));
  check("no ledger field appears anywhere in the payload",
        onWire.length === 0, onWire.join(", "));
  check("and no derived money either",
        !body.includes("$11.70") && !body.includes("$7.20") &&
          !body.includes("$4.50") && !body.includes("$3.60"),
        "a cost figure reached the JSON API");

  const ownWire = await client.raw(`${APP}/api/stories/${story.id}`);
  const ownBody = await ownWire.text();
  check("a client reads their own ticket", ownWire.status === 200, `status ${ownWire.status}`);
  const ownLeak = keysOf(JSON.parse(ownBody)).filter((k) => OFF_WIRE.includes(k));
  check("and their wire is just as clean", ownLeak.length === 0, ownLeak.join(", "));

  // ------------------------------------------------------------------
  section("what the ledger refuses");

  const garbagePage = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  const refused = await ruben.submit(`${APP}/story/${story.id}`, garbagePage,
    formIndexContaining(garbagePage, 'name="weightGrams"'),
    { weightGrams: "abc", printMinutes: "90" });
  check("a non-number is refused",
        paramOf(refused.headers.get("location"), "error").includes("Whole grams and whole minutes"),
        paramOf(refused.headers.get("location"), "error"));
  row = await db.story.findUnique({ where: { id: story.id } });
  check("and the weigh-in stands", row?.weightGrams === 120 && row?.printMinutes === 90);

  // A client cannot record cost at all — the form is not drawn for
  // them, and the action answers 404 rather than 403, so poking at
  // the URL teaches nothing.
  const hostile = new FormData();
  hostile.set("storyId", String(story.id));
  hostile.set("from", `/story/${story.id}`);
  hostile.set("weightGrams", "5");
  hostile.set("printMinutes", "5");
  const trespass = await client.raw(`${APP}/story/${story.id}`, {
    method: "POST", body: hostile,
  });
  check("a client's ledger POST is 404, not 403", trespass.status === 404, `status ${trespass.status}`);
  row = await db.story.findUnique({ where: { id: story.id } });
  check("and records nothing", row?.weightGrams === 120 && row?.printMinutes === 90);
  check("the client never appears in the cost trail",
        (await db.auditEvent.count({ where: { actorId: ayla.id, action: "story.costed" } })) === 0);

  // ------------------------------------------------------------------
  section("a blank field clears its number");

  const clearPage = await (await ruben.go(`${APP}/story/${story.id}`)).text();
  const cleared = await ruben.submit(`${APP}/story/${story.id}`, clearPage,
    formIndexContaining(clearPage, 'name="weightGrams"'),
    { weightGrams: "", printMinutes: "" });
  check("clearing redirects like a recording",
        paramOf(cleared.headers.get("location"), "toast").includes("Cost recorded for"),
        paramOf(cleared.headers.get("location"), "toast"));
  row = await db.story.findUnique({ where: { id: story.id } });
  check("the numbers are gone", row?.weightGrams === null && row?.printMinutes === null,
        JSON.stringify({ g: row?.weightGrams, min: row?.printMinutes }));
  check("the clear is audited too",
        (await db.auditEvent.count({ where: { action: "story.costed" } })) === 2);

  page = rendered(await (await ruben.go(`${APP}/story/${story.id}`)).text());
  check("the ledger reads empty again", page.includes("No measurements recorded yet"));
  check("at the new rates", page.includes("60.00 $/kg + 3.00 $/hour"));
  const finalQueue = rendered(await (await ruben.go(`${APP}/queue`)).text());
  check("and the queue ticket carries no cost chip", !finalQueue.includes("$11.70"));

  console.info(
    `\n${passed} checks passed, ${failures.length} failed` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
