import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { listAllMaterials } from "@/lib/materials";
import { currencySymbol, formatRate } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { AppHeader } from "@/components/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { setMachineRateAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The rates tab — what an hour of the machine costs, and, for reference,
 * what each material costs per kilogram.
 *
 * The machine rate is one figure for the shop: one machine by the window,
 * one row (`MachineRate`, id "default"), edited here and nowhere else. The
 * per-material $/kg prices are edited beside their materials on the Materials
 * tab — a material and its price are one fact, and two screens that could say
 * different things about the same material is how drift starts. They are
 * listed here read-only so the whole ledger is visible from one place.
 *
 * Admin-only: `requireAdmin` answers 404, so a client learns nothing about
 * this route. Plain server-rendered forms, JavaScript off and it still works.
 */
export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const [machine, materials, settings] = await Promise.all([
    db.machineRate.findUnique({ where: { id: "default" } }),
    listAllMaterials(),
    getSettings(),
  ]);
  const { currency } = settings;

  return (
    <>
      <AppHeader user={admin} active="/admin/settings/rates" />

      <main className="mx-auto w-full max-w-[720px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <SettingsTabs active="rates" />

        <Kicker>Rates</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          What an hour costs
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The machine&rsquo;s price per hour — depreciation, electricity, the
          wear on the nozzle. Alongside each material&rsquo;s price per
          kilogram, it is what the cost ledger on a ticket is derived from, at
          render, from whatever the rates are that day. Nothing is snapshotted:
          a past ticket does not pretend today&rsquo;s filament price is what
          it cost.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {/* The machine rate */}
        <form
          action={setMachineRateAction}
          className="mb-[26.4px] flex flex-wrap items-end gap-[8.8px] rounded-panel border-[3px] border-ink bg-aqua-wash p-[17.6px] shadow-stamp"
        >
          <div>
            <label
              htmlFor="machine-rate"
              className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
            >
              Machine rate ({currencySymbol(currency)}/hour)
            </label>
            <input
              id="machine-rate"
              name="dollarsPerHour"
              type="number"
              min="0"
              max="10000"
              step="0.01"
              defaultValue={machine?.dollarsPerHour ?? ""}
              placeholder="—"
              required
              className="w-[140px] rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[11px] font-mono text-[16px] text-ink placeholder:text-ink-3"
            />
          </div>
          <button
            type="submit"
            className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[22px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
          >
            Save
          </button>
          {machine == null && (
            <p className="m-0 mb-[4px] flex-[1_1_220px] text-[13.5px] leading-[1.45] text-ink-2">
              Not set yet — until it is, a costed ticket shows filament only.
            </p>
          )}
        </form>

        {/* What the shop charges, as opposed to what it pays, is the General
            tab's business — one link rather than a second copy of the markup
            field, which is how two screens start disagreeing. */}
        <p className="m-0 mb-[26.4px] max-w-[62ch] text-[14px] leading-[1.5] text-ink-2">
          These are the prices the shop <em>pays</em>. What it asks for is on
          the{" "}
          <a href="/admin/settings" className="underline underline-offset-4 hover:text-cherry-dk">
            General
          </a>{" "}
          tab: markup on cost, a minimum charge, and the currency every figure
          in the app is shown in.
        </p>

        {/* The per-material prices, read-only here */}
        <section>
          <h2 className="m-0 mb-[11px] font-display text-[20px] text-ink">Per material</h2>
          <p className="m-0 mb-[13.2px] max-w-[62ch] text-[14px] leading-[1.5] text-ink-2">
            Set beside each material on the{" "}
            <a
              href="/admin/settings/materials"
              className="underline underline-offset-4 hover:text-cherry-dk"
            >
              Materials
            </a>{" "}
            tab.
          </p>
          <div className="overflow-hidden rounded-panel border-[3px] border-ink bg-porcelain shadow-stamp">
            {materials.map((m, i) => (
              <div
                key={m.id}
                className={`flex items-center justify-between gap-[13.2px] px-[17.6px] py-[11px] ${
                  i < materials.length - 1 ? "border-b-2 border-dashed border-rule" : ""
                } ${m.active ? "" : "opacity-60"}`}
              >
                <span className="font-bold text-[15px] text-ink">
                  {m.name}
                  {!m.active && (
                    <span className="ml-[8.8px] font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3">
                      retired
                    </span>
                  )}
                </span>
                <span className="font-mono text-[13px] font-bold text-ink-2">
                  {m.dollarsPerKg != null
                    ? formatRate(m.dollarsPerKg, currency, "kg")
                    : "no price yet"}
                </span>
              </div>
            ))}
            {materials.length === 0 && (
              <p className="m-0 p-[17.6px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
                No materials yet.
              </p>
            )}
          </div>
        </section>
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
