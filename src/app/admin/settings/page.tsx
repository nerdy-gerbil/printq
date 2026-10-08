import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { ReactNode } from "react";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { ipSource, type IpSource } from "@/lib/client-ip";
import { mailTransport } from "@/lib/email";
import { listActiveMaterials } from "@/lib/materials";
import { formatBytes } from "@/lib/models";
import { CURRENCIES, currencySymbol } from "@/lib/money";
import {
  MAX_UPLOAD_MB,
  SETTING_SECTIONS,
  getSettings,
  settingBounds,
  settingHelp,
  settingKind,
  settingLabel,
  settingShown,
  settingsInSection,
  type AppSettings,
  type SettingSection,
} from "@/lib/settings";
import { AppHeader } from "@/components/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Button, Input, Kicker, Label, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { saveSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings — the dials that are not about one material or one ticket.
 *
 * Every field here is read from, and written to, the registry in
 * `src/lib/settings.ts`: the page walks that registry rather than listing the
 * keys, so a setting arrives with its label, its help text, its validation and
 * its default in one place, and this screen cannot offer a field the server
 * will not accept.
 *
 * The tabs along the top are the parts of running the shop that are about one
 * object rather than about the whole shop: a material, the colours it comes in,
 * and the rates. Each is its own page and its own form, because a material and
 * its price per kilogram are one fact and two screens that can disagree about
 * it is how drift starts — but they are one subject, so they sit under one roof
 * rather than in the main nav.
 *
 * What is deliberately *not* here matters as much. Benefits and the guest list
 * keep their own screens. Nothing on this page is per-person; that is the guest
 * list's job.
 *
 * Every section is a plain form with one Save: JavaScript off, it still works,
 * like the rest of the admin surfaces. Every change is audited, and the panel
 * at the bottom is the read-only half — what this particular installation is.
 */
const SECTION_COPY: Record<SettingSection, { title: string; blurb: string }> = {
  money: {
    title: "Money",
    blurb:
      "The currency every figure is shown in, and what the app asks for over cost. The rates underneath — a kilogram of filament, an hour of the machine — stay on the Rates and Materials tabs, because a material and its price are one fact.",
  },
  orders: {
    title: "New orders",
    blurb:
      "Whether the shop is open, what the upload form starts on, and how large a model may be. Pausing stops new requests; it never touches a ticket already on the rail.",
  },
  people: {
    title: "Guests and invitations",
    blurb:
      "Who can get in is the guest list's business. How long the link lasts is here.",
  },
  identity: {
    title: "The sign over the door",
    blurb:
      "What the app calls the people who run the printer, wherever it would otherwise say it for you.",
  },
};

// Materials and Rates are not on this list: they are tabs of this screen now.
const LINKS = [
  { label: "Benefits", href: "/admin/benefits" },
  { label: "Guest list", href: "/admin/invites" },
  { label: "Wishlist", href: "/admin/wishlist" },
  { label: "Audit", href: "/admin/audit" },
];

const SELECT =
  "w-full cursor-pointer rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[12px] text-[16px] text-ink";

type Deployment = {
  database: string;
  databaseBytes: number;
  storageRoot: string;
  storageWritable: boolean;
  mail: string;
  proxy: IpSource;
  people: number;
  passkeys: number;
  requests: number;
  auditRows: number;
};

/**
 * What this installation is, read-only.
 *
 * The questions whoever operates it has to answer and cannot ask the app from
 * the inside: which database, how big, where the models are, whether mail can
 * leave, and which header the audit trail trusts. Nothing here is a secret —
 * a version, a size, a path, a count.
 *
 * The last one earns its place because it is the only one that fails quietly:
 * with no trusted header every audit row's address is blank and sign-in rate
 * limiting collapses into one bucket shared by the whole office, and nothing
 * anywhere else says so out loud.
 */
async function readDeployment(): Promise<Deployment> {
  const storageRoot = resolve(process.env.MODELS_ROOT ?? "/uploads");

  const [version, size, people, passkeys, requests, auditRows, writable] = await Promise.all([
    db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`,
    db.$queryRaw<Array<{ bytes: bigint | number | null }>>`
      SELECT SUM(data_length + index_length) AS bytes
      FROM information_schema.TABLES
      WHERE table_schema = DATABASE()`,
    db.user.count(),
    db.passkey.count(),
    db.story.count(),
    db.auditEvent.count(),
    access(storageRoot, constants.W_OK)
      .then(() => true)
      .catch(() => false),
  ]);

  return {
    database: version[0]?.version ?? "unknown",
    databaseBytes: Number(size[0]?.bytes ?? 0),
    storageRoot,
    storageWritable: writable,
    mail: mailTransport(),
    proxy: ipSource(),
    people,
    passkeys,
    requests,
    auditRows,
  };
}

/** One labelled fact in the deployment panel. */
function Diag({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-[4px] font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">
        {label}
      </dt>
      <dd className="m-0 break-words text-[14.5px] font-bold text-ink">{children}</dd>
    </div>
  );
}

/**
 * One setting's control, chosen from the registry rather than by name: only
 * the two enumerable fields and the checkbox need anything the registry
 * cannot describe, and the rest are a text or number input by whether the
 * default is a number.
 */
function renderSetting(
  key: keyof AppSettings,
  settings: AppSettings,
  materials: Array<{ name: string }>,
) {
  const help = settingHelp(key);

  if (settingKind(key) === "checkbox") {
    return (
      <label key={key} className="flex cursor-pointer items-start gap-[10px]">
        <input
          type="checkbox"
          id={key}
          name={key}
          defaultChecked={Boolean(settings[key])}
          className="mt-[3px] h-[18px] w-[18px] flex-none cursor-pointer rounded-[4px] border-[3px] border-ink bg-porcelain"
        />
        <span>
          <span className="block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
            {settingLabel(key)}
          </span>
          <span className="mt-[5px] block text-[13px] leading-[1.45] text-ink-3">{help}</span>
        </span>
      </label>
    );
  }

  const bounds = settingBounds(key);

  return (
    <div key={key}>
      <Label htmlFor={key}>{settingLabel(key)}</Label>
      {key === "currency" ? (
        <select id={key} name={key} defaultValue={settings.currency} className={SELECT}>
          {CURRENCIES.map((option) => (
            <option key={option.code} value={option.code}>
              {currencySymbol(option.code)} · {option.code} — {option.name}
            </option>
          ))}
        </select>
      ) : key === "defaultMaterial" ? (
        <select id={key} name={key} defaultValue={settings.defaultMaterial} className={SELECT}>
          <option value="">First on the materials list</option>
          {materials.map((material) => (
            <option key={material.name} value={material.name}>
              {material.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={key}
          name={key}
          type={bounds ? "number" : "text"}
          min={bounds?.min}
          max={bounds?.max}
          step={bounds?.step}
          defaultValue={settingShown(key, settings[key])}
        />
      )}
      <p className="m-0 mt-[5px] text-[13px] leading-[1.45] text-ink-3">{help}</p>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const [settings, materials, deployment] = await Promise.all([
    getSettings(),
    listActiveMaterials(),
    readDeployment(),
  ]);

  return (
    <>
      <AppHeader user={admin} active="/admin/settings" />

      <main className="mx-auto w-full max-w-[880px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <SettingsTabs active="general" />
        <Kicker>Behind the counter</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          How the shop runs
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The settings that are not about one material or one ticket — what
          money looks like, what the app asks for over cost, whether it is
          taking work, how big an upload may be, and what it calls the team.
          Every change here is recorded in the audit trail.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {SETTING_SECTIONS.map((section) => (
          <form
            key={section}
            action={saveSettingsAction}
            className="mb-[22px] rounded-panel border-[3px] border-ink bg-porcelain p-[22px] shadow-stamp"
          >
            <input type="hidden" name="section" value={section} />
            <h2 className="m-0 mb-[6px] font-display text-[22px] text-ink">
              {SECTION_COPY[section].title}
            </h2>
            <p className="m-0 mb-[17.6px] max-w-[62ch] text-[14.5px] leading-[1.5] text-ink-2">
              {SECTION_COPY[section].blurb}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-[17.6px]">
              {settingsInSection(section).map((key) =>
                renderSetting(key, settings, materials),
              )}
            </div>
            <div className="mt-[17.6px]">
              <Button type="submit">Save</Button>
            </div>
          </form>
        ))}

        <section className="mb-[22px] rounded-panel border-[3px] border-ink bg-cream-2 p-[22px] shadow-stamp">
          <h2 className="m-0 mb-[6px] font-display text-[22px] text-ink">
            This deployment
          </h2>
          <p className="m-0 mb-[17.6px] max-w-[62ch] text-[14.5px] leading-[1.5] text-ink-2">
            Read-only. These are the questions whoever runs this installation
            has to answer from outside the app, and none of the answers is a
            secret.
          </p>
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[17.6px]">
            <Diag label="Database">
              {deployment.database} · {formatBytes(deployment.databaseBytes)}
            </Diag>
            <Diag label="Models on disk">
              <span className="font-mono text-[13px]">{deployment.storageRoot}</span>{" "}
              {deployment.storageWritable ? "· writable" : "· NOT writable"}
            </Diag>
            <Diag label="Outgoing mail">
              {deployment.mail === "none"
                ? "none — invitation links are shown to you to hand over"
                : deployment.mail}
            </Diag>
            <Diag label="Client address">
              {deployment.proxy === "none"
                ? "not trusted — audit rows record no address"
                : `from ${deployment.proxy === "cloudflare" ? "CF-Connecting-IP" : "X-Forwarded-For"}`}
            </Diag>
            <Diag label="Accounts">
              {deployment.people} {deployment.people === 1 ? "person" : "people"} ·{" "}
              {deployment.passkeys} {deployment.passkeys === 1 ? "passkey" : "passkeys"}
            </Diag>
            <Diag label="Work on file">
              {deployment.requests} {deployment.requests === 1 ? "request" : "requests"} ·{" "}
              {deployment.auditRows} audit {deployment.auditRows === 1 ? "row" : "rows"}
            </Diag>
          </dl>

          {deployment.proxy === "none" && (
            <div className="mt-[17.6px]">
              <Notice tone="warn">
                No client address is being recorded: every audit row&rsquo;s
                address is blank, and sign-in attempts are rate limited against
                a single bucket shared by the whole office rather than one per
                address. Set <span className="font-mono">TRUST_PROXY_HEADERS</span>{" "}
                on the server to <span className="font-mono">true</span> if
                something in front of the app <em>replaces</em>{" "}
                <span className="font-mono">X-Forwarded-For</span>, or to{" "}
                <span className="font-mono">cloudflare</span> behind Cloudflare.
                Leave it off if the app is reached directly — a blank address is
                honest, and a spoofable one is worse than none.
              </Notice>
            </div>
          )}
        </section>

        <section>
          <h2 className="m-0 mb-[11px] font-display text-[22px] text-ink">
            The rest of the office
          </h2>
          <p className="m-0 mb-[13.2px] max-w-[62ch] text-[14.5px] leading-[1.5] text-ink-2">
            Each of these has its own screen on purpose — a benefit and its
            preferred flag are one fact, the same way a material, its colours
            and its price per kilogram are, and each is edited in one place
            rather than two.
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-[8.8px] p-0">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-block rounded-chip border-2 border-ink bg-porcelain px-[13px] py-[7px] font-mono text-[12px] font-bold uppercase tracking-[0.06em] text-ink hover:bg-sun"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-[13.2px] font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
            Uploads are capped at {MAX_UPLOAD_MB} MB by this build; the setting
            above can only lower that.
          </p>
        </section>
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
