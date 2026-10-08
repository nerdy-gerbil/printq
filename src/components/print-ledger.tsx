import { recordCostAction } from "@/app/actions/stories";
import { formatMinutes } from "@/lib/cost";
import { formatRate } from "@/lib/money";

/**
 * The print team's ledger entry, on a ticket.
 *
 * The inputs are two numbers measured once the print is real — filament
 * weighed in grams, wall-clock minutes on the bed — and nothing is inferred:
 * the same rule that dropped the print-time estimate, applied to money. A
 * blank field clears its number, so a mistyped weigh-in can be taken back.
 *
 * The cost itself is computed at render from the CURRENT rates and is never
 * stored — see `src/lib/cost.ts`. Behind a disclosure because most tickets
 * are being read, not costed; the numbers live one click away, not in the
 * way.
 */
export function PrintLedger({
  storyId,
  weightGrams,
  printMinutes,
  dollarsPerKg,
  dollarsPerHour,
  currency,
  from,
}: {
  storyId: number;
  weightGrams: number | null;
  printMinutes: number | null;
  /** Current rates, so the form can say what the numbers will be multiplied by. */
  dollarsPerKg: number | null;
  dollarsPerHour: number | null;
  /** The shop's currency, passed down: this module renders on both sides. */
  currency: string;
  from: string;
}) {
  return (
    <details className="mt-[13.2px]">
      <summary className="inline-block cursor-pointer list-none rounded-chip border-[3px] border-ink bg-porcelain px-[13px] py-[6px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink hover:bg-cream-2">
        Cost ledger
      </summary>
      <form
        action={recordCostAction}
        className="mt-[8px] rounded-card border-[3px] border-ink bg-porcelain p-[15px]"
      >
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="from" value={from} />
        <p className="m-0 mb-[11px] text-[13.5px] leading-[1.45] text-ink-2">
          What the print weighed and how long it ran — measured, not guessed.
          {dollarsPerKg != null && dollarsPerHour != null
            ? ` Cost is derived at ${formatRate(dollarsPerKg, currency, "kg")} and ${formatRate(dollarsPerHour, currency, "hour")}, at render, from the current rates.`
            : " Set rates under Materials and Rates first."}
        </p>
        <div className="flex flex-wrap items-end gap-[13.2px]">
          <label className="flex flex-col gap-[4px]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
              Filament (g)
            </span>
            <input
              type="number"
              name="weightGrams"
              min="0"
              max="100000"
              step="1"
              defaultValue={weightGrams ?? ""}
              placeholder="—"
              className="w-[110px] rounded-chip border-2 border-ink bg-cream-2 px-[11px] py-[6px] font-mono text-[14px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
              Time on bed (min)
            </span>
            <input
              type="number"
              name="printMinutes"
              min="0"
              max="86400"
              step="1"
              defaultValue={printMinutes ?? ""}
              placeholder="—"
              className="w-[110px] rounded-chip border-2 border-ink bg-cream-2 px-[11px] py-[6px] font-mono text-[14px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-mint px-[15px] py-[7px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink hover:bg-mint-dk"
          >
            Record
          </button>
        </div>
        {(weightGrams != null || printMinutes != null) && (
          <p className="m-0 mt-[9px] font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
            Recorded: {weightGrams != null ? `${weightGrams} g` : "no weight"}
            {" · "}
            {printMinutes != null ? formatMinutes(printMinutes) : "no time"}
          </p>
        )}
      </form>
    </details>
  );
}
