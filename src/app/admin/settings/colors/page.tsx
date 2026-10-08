import { requireAdmin } from "@/lib/authz";
import { BUILT_IN_PALETTE, listAllColors, type ColorRow } from "@/lib/colors";
import { listAllMaterials } from "@/lib/materials";
import { AppHeader } from "@/components/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import {
  addBuiltInColorsAction,
  createColorAction,
  setColorActiveAction,
  updateColorAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * The Colours tab — what each material is offered in.
 *
 * A colour belongs to a material, not to the app: a spool of PLA is not stocked
 * in the shades a bottle of resin is. So this page is a block per material, and
 * the upload form offers a material's own list the moment the requester picks
 * it — which is why the order on screen is the order on the form.
 *
 * A material with nothing configured is not a material with no colours: it falls
 * back to the five swatches this app shipped with, so uploading works before
 * anybody comes here. That fallback is invisible, though, and a palette nobody
 * can see is a palette nobody can edit — so a material with no rows of its own
 * gets a button that writes those five down as real, editable rows.
 *
 * Editing a colour never rewrites a past ticket: a story stores the name and the
 * swatch it was asked for, so a recolour shows on the next request and nowhere
 * else. Retiring one drops it off the form and leaves history alone.
 *
 * Plain server-rendered forms throughout, so this works with JavaScript off like
 * the rest of the admin surfaces — which is also why the swatch beside a hex
 * input shows what is *stored* rather than previewing what is being typed.
 */
const FIELD =
  "w-full rounded-card border-[3px] border-ink bg-porcelain px-[12px] py-[9px] text-[15px] text-ink placeholder:text-ink-3";
const CHIP =
  "cursor-pointer rounded-chip border-2 border-ink bg-porcelain px-[12px] py-[6px] font-mono text-[11px] font-bold uppercase text-ink hover:bg-sun";

/** One colour's stored swatch, at the size the form uses. */
function Swatch({ hex, faded = false }: { hex: string; faded?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-[26px] w-[26px] flex-none rounded-full border-[3px] border-ink ${
        faded ? "opacity-50" : ""
      }`}
      style={{ background: hex }}
    />
  );
}

export default async function ColorsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const [materials, colors] = await Promise.all([listAllMaterials(), listAllColors()]);

  const byMaterial = new Map<string, ColorRow[]>();
  for (const color of colors) {
    const rows = byMaterial.get(color.material) ?? [];
    rows.push(color);
    byMaterial.set(color.material, rows);
  }

  return (
    <>
      <AppHeader user={admin} active="/admin/settings/colors" />

      <main className="mx-auto w-full max-w-[880px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <SettingsTabs active="colors" />

        <Kicker>Colours</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          What each material comes in
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The colours the upload form offers for each material. Add a material
          on the Materials tab and its colours here; the pair is the fact, so
          &ldquo;Teal&rdquo; on PETG and &ldquo;Teal&rdquo; on resin are two
          different spools. Retire a colour to take it off the form — every past
          request keeps the swatch it was asked for.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {materials.length === 0 && (
          <p className="m-0 rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[13.2px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
            No materials yet — add one on the Materials tab, then give it colours.
          </p>
        )}

        {materials.map((material) => {
          const rows = byMaterial.get(material.name) ?? [];
          const live = rows.filter((c) => c.active);
          const retired = rows.filter((c) => !c.active);

          return (
            <section
              key={material.id}
              className="mb-[22px] rounded-panel border-[3px] border-ink bg-porcelain p-[22px] shadow-stamp"
            >
              <div className="mb-[13.2px] flex flex-wrap items-baseline justify-between gap-[8.8px]">
                <h2 className="m-0 font-display text-[22px] text-ink">
                  {material.name}
                  {!material.active && (
                    <span className="ml-[8.8px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                      retired material
                    </span>
                  )}
                </h2>
                <span className="font-mono text-[11.5px] uppercase tracking-[0.05em] text-ink-3">
                  {rows.length === 0
                    ? "no colours of its own"
                    : `${live.length} on the form${retired.length > 0 ? ` · ${retired.length} retired` : ""}`}
                </span>
              </div>

              {rows.length === 0 && (
                <div className="mb-[13.2px]">
                  <Notice tone="warn">
                    Nothing configured for {material.name} yet, so the upload
                    form is offering the five swatches this app ships with —{" "}
                    {BUILT_IN_PALETTE.map((c) => c.name).join(", ")}. Write them
                    down as editable rows, or add your own below.
                  </Notice>
                </div>
              )}

              {/* ---- live colours ---- */}
              <div className="flex flex-col gap-[8.8px]">
                {live.map((color) => (
                  <div
                    key={color.id}
                    className="flex flex-wrap items-center gap-[8.8px] rounded-card border-[3px] border-ink bg-cream-2 px-[13.2px] py-[11px]"
                  >
                    <Swatch hex={color.hex} />
                    <form
                      action={updateColorAction}
                      className="flex flex-[1_1_320px] flex-wrap items-center gap-[8.8px]"
                    >
                      <input type="hidden" name="id" value={color.id} />
                      <input
                        name="name"
                        required
                        maxLength={40}
                        defaultValue={color.name}
                        aria-label={`Name for the ${color.name} swatch on ${material.name}`}
                        className={`${FIELD} flex-[1_1_150px]`}
                      />
                      <input
                        name="hex"
                        required
                        pattern="#[0-9a-fA-F]{6}"
                        defaultValue={color.hex}
                        aria-label={`Hex for the ${color.name} swatch on ${material.name}`}
                        className={`${FIELD} flex-[0_1_120px] font-mono`}
                      />
                      <button type="submit" className={CHIP}>
                        Save
                      </button>
                    </form>
                    <form action={setColorActiveAction}>
                      <input type="hidden" name="id" value={color.id} />
                      <input type="hidden" name="active" value="false" />
                      <button type="submit" className={CHIP}>
                        Retire
                      </button>
                    </form>
                  </div>
                ))}

                {live.length === 0 && rows.length > 0 && (
                  <p className="m-0 rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[13.2px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
                    Every colour is retired, so the form falls back to the
                    built-in five — restore one or add another.
                  </p>
                )}
              </div>

              {/* ---- add ---- */}
              <form
                action={createColorAction}
                className="mt-[13.2px] flex flex-wrap items-end gap-[8.8px] border-t-[3px] border-dashed border-rule pt-[13.2px]"
              >
                <input type="hidden" name="material" value={material.name} />
                <div className="flex-[1_1_180px]">
                  <label
                    htmlFor={`new-name-${material.id}`}
                    className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
                  >
                    Add a colour to {material.name}
                  </label>
                  <input
                    id={`new-name-${material.id}`}
                    name="name"
                    required
                    maxLength={40}
                    autoComplete="off"
                    placeholder="Teal"
                    className={FIELD}
                  />
                </div>
                <div className="flex-[0_1_130px]">
                  <label
                    htmlFor={`new-hex-${material.id}`}
                    className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
                  >
                    Hex
                  </label>
                  <input
                    id={`new-hex-${material.id}`}
                    name="hex"
                    required
                    pattern="#[0-9a-fA-F]{6}"
                    autoComplete="off"
                    placeholder="#4a5d78"
                    className={`${FIELD} font-mono`}
                  />
                </div>
                <button type="submit" className={CHIP}>
                  Add
                </button>
                {rows.length === 0 && (
                  /*
                   * `formNoValidate`, because the two fields above are
                   * required: without it the browser refuses to submit this
                   * button at all and tells the owner to fill in a name they
                   * never wanted to type. This posts to its own action, which
                   * reads only the hidden material.
                   */
                  <button
                    type="submit"
                    formAction={addBuiltInColorsAction}
                    formNoValidate
                    className={`${CHIP} bg-aqua-wash`}
                  >
                    Add the built-in five
                  </button>
                )}
              </form>

              {/* ---- retired ---- */}
              {retired.length > 0 && (
                <div className="mt-[13.2px] flex flex-col gap-[6.6px]">
                  {retired.map((color) => (
                    <div
                      key={color.id}
                      className="flex flex-wrap items-center justify-between gap-[8.8px] rounded-card border-2 border-dashed border-ink-3 bg-cream-2 px-[13.2px] py-[9px]"
                    >
                      <span className="flex items-center gap-[8.8px]">
                        <Swatch hex={color.hex} faded />
                        <span className="font-mono text-[13px] text-ink-3 line-through">
                          {color.name} · {color.hex}
                        </span>
                      </span>
                      <form action={setColorActiveAction}>
                        <input type="hidden" name="id" value={color.id} />
                        <input type="hidden" name="active" value="true" />
                        <button type="submit" className={CHIP}>
                          Restore
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
          A hex is six digits of red, green and blue — the swatch beside each row
          shows what is stored, not what is being typed, because this page has to
          work with JavaScript off.
        </p>
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
