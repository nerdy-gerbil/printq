import { requireAdmin } from "@/lib/authz";
import { listAllMaterials } from "@/lib/materials";
import { currencySymbol } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { AppHeader } from "@/components/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import {
  createMaterialAction,
  renameMaterialAction,
  setMaterialActiveAction,
  setMaterialDensityAction,
  setMaterialRateAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Manage the materials catalogue — what a request can be made from, and what
 * each costs per kilogram. Admin-only: `requireAdmin` answers 404, so a
 * client learns nothing about this route.
 *
 * This is the Materials tab of the settings screen. A material and its price
 * are one fact, so they are edited in one place — the machine's $/hour lives
 * on the next tab, at `/admin/settings/rates`, and the colours each material
 * is offered in on the tab beside that, at `/admin/settings/colors`. Plain
 * server-rendered forms, so the whole screen works with JavaScript off, like
 * the rest of the admin surfaces. A retired material is kept (not deleted) so
 * past requests made in it still read correctly.
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const [materials, settings] = await Promise.all([listAllMaterials(), getSettings()]);
  const { currency } = settings;

  const live = materials.filter((m) => m.active);
  const retired = materials.filter((m) => !m.active);

  return (
    <>
      <AppHeader user={admin} active="/admin/settings/materials" />

      <main className="mx-auto w-full max-w-[880px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <SettingsTabs active="materials" />

        <Kicker>Materials</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          What things are made of
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The materials people can ask for, and what each costs you per
          kilogram — the price feeds the cost ledger on the team&rsquo;s
          tickets. The density, beside it, is what turns the volume the app
          measures from an uploaded mesh into grams, and so into the estimate a
          requester sees before they send a file. Retire a material to take it
          off the upload form without touching past requests made in it.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {/* Add */}
        <form
          action={createMaterialAction}
          className="mb-[26.4px] flex flex-wrap items-end gap-[8.8px] rounded-panel border-[3px] border-ink bg-aqua-wash p-[17.6px] shadow-stamp"
        >
          <div className="flex-[1_1_240px]">
            <label
              htmlFor="new-material"
              className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
            >
              Add a material
            </label>
            <input
              id="new-material"
              name="name"
              required
              maxLength={40}
              autoComplete="off"
              placeholder="PETG"
              className="w-full rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[11px] text-[16px] text-ink placeholder:text-ink-3"
            />
          </div>
          <button
            type="submit"
            className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[22px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
          >
            Add
          </button>
        </form>

        {/* Live list */}
        <div className="flex flex-col gap-[11px]">
          {live.map((m) => (
            <div
              key={m.id}
              className="rounded-card border-[3px] border-ink bg-porcelain p-[15px] shadow-stamp"
            >
              <div className="flex flex-wrap items-center gap-[8.8px]">
                {/* Rename (inline) */}
                <form action={renameMaterialAction} className="flex flex-[1_1_200px] items-center gap-[8px]">
                  <input type="hidden" name="id" value={m.id} />
                  <input
                    name="name"
                    defaultValue={m.name}
                    maxLength={40}
                    aria-label={`Rename ${m.name}`}
                    className="min-w-[120px] flex-1 rounded-[8px] border-[3px] border-ink bg-cream-2 px-[11px] py-[7px] font-bold text-[15px] text-ink"
                  />
                  <button
                    type="submit"
                    className="cursor-pointer rounded-chip border-2 border-ink bg-porcelain px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink hover:bg-sun"
                  >
                    Save
                  </button>
                </form>

                {/* Per-kilogram price (inline) */}
                <form action={setMaterialRateAction} className="flex items-center gap-[8px]">
                  <input type="hidden" name="name" value={m.name} />
                  <label className="flex items-center gap-[6px] font-mono text-[12px] font-bold text-ink-2">
                    {currencySymbol(currency)}/kg
                    <input
                      name="dollarsPerKg"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      defaultValue={m.dollarsPerKg ?? ""}
                      placeholder="—"
                      aria-label={`Price per kilogram for ${m.name}`}
                      className="w-[86px] rounded-[8px] border-2 border-ink bg-cream-2 px-[9px] py-[7px] font-mono text-[14px] text-ink"
                    />
                  </label>
                  <button
                    type="submit"
                    className="cursor-pointer rounded-chip border-2 border-ink bg-porcelain px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink hover:bg-sun"
                  >
                    Set
                  </button>
                </form>

                {/* Filament density, g/cm³ — what turns a measured mesh
                    volume into grams. Its own form because it answers a
                    different question from the price: a wrong price costs
                    money, a wrong density costs an estimate. */}
                <form action={setMaterialDensityAction} className="flex items-center gap-[8px]">
                  <input type="hidden" name="name" value={m.name} />
                  <label className="flex items-center gap-[6px] font-mono text-[12px] font-bold text-ink-2">
                    g/cm³
                    <input
                      name="densityGcm3"
                      type="number"
                      min="0.1"
                      max="5"
                      step="0.01"
                      defaultValue={m.densityGcm3}
                      aria-label={`Filament density for ${m.name}, in grams per cubic centimetre`}
                      className="w-[86px] rounded-[8px] border-2 border-ink bg-cream-2 px-[9px] py-[7px] font-mono text-[14px] text-ink"
                    />
                  </label>
                  <button
                    type="submit"
                    className="cursor-pointer rounded-chip border-2 border-ink bg-porcelain px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink hover:bg-mint-wash"
                  >
                    Set
                  </button>
                </form>

                {/* Retire */}
                <form action={setMaterialActiveAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="active" value="false" />
                  <button
                    type="submit"
                    className="cursor-pointer rounded-chip border-2 border-ink bg-cream-2 px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink-2 hover:bg-cherry-wash"
                  >
                    Retire
                  </button>
                </form>
              </div>
            </div>
          ))}
          {live.length === 0 && (
            <p className="m-0 rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[13.2px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
              No materials on the list — add one above, or nobody can ask for a print.
            </p>
          )}
        </div>

        {/* Retired */}
        {retired.length > 0 && (
          <section className="mt-[35.2px]">
            <h2 className="m-0 mb-[13.2px] font-display text-[20px] text-ink">Retired</h2>
            <div className="flex flex-col gap-[8.8px]">
              {retired.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-[8.8px] rounded-card border-[3px] border-ink bg-cream-2 px-[15px] py-[11px] opacity-80"
                >
                  <span className="font-bold text-[15px] text-ink-2 line-through">{m.name}</span>
                  <form action={setMaterialActiveAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="active" value="true" />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-chip border-2 border-ink bg-porcelain px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink hover:bg-mint-wash"
                    >
                      Restore
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
