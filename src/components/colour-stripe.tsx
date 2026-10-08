import { COLORS } from "@/lib/catalog";

/**
 * The filament stripe on a ticket, worn down the left edge the way an order
 * gets colour-coded.
 *
 * A multi-colour print asks for more than one spool, so the stripe carries
 * them all: the primary colour first, then the extras in the order the
 * requester numbered them, sliced into equal bands. A requester picks names,
 * not hexes, so a band wears the swatch that name stood for — and a name with
 * nothing to show falls back to the pale "unset" swatch, which reads as
 * "asked-for, not stocked" rather than pretending to be a colour.
 *
 * Each extra colour's swatch now travels on the ticket — `additionalColors`,
 * written at upload time and narrowed by `storedSwatches` just below — because
 * a palette belongs to the material and is owner-managed: a lookup in a
 * compile-time list cannot know the colour somebody added this morning, and it
 * would quietly show the pale "asked-for, not stocked" band for a colour that
 * is very much stocked. The old name-only lookup stays as the fallback, which
 * is what a ticket uploaded before the column existed still needs.
 *
 * Rendered as stacked flex children rather than a single gradient: hard
 * edges between bands are the point — three spools, three bands.
 */
/**
 * The extra colours a ticket recorded, narrowed out of the JSON column.
 *
 * `additionalColors` reaches a component as `unknown` — it is a JSON column —
 * so something has to decide it really is a list of `{ name, hex }` before any
 * of it is rendered. That decision lives here rather than in each caller, and a
 * row from before the column existed narrows to an empty list, which is exactly
 * what the name-only fallback wants.
 */
export function storedSwatches(value: unknown): Array<{ name: string; hex: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is { name: string; hex: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      typeof (entry as { hex?: unknown }).hex === "string",
  );
}

export function ColourStripe({
  colorHex,
  additionalColorNames,
  additionalColors,
  className = "",
}: {
  colorHex: string;
  /** Each extra colour as the ticket asked for it, hex included. Preferred
   *  over the name-only lookup; empty for older tickets. */
  additionalColors?: Array<{ name: string; hex: string }> | null;
  additionalColorNames?: string[] | null;
  className?: string;
}) {
  const stored = storedSwatches(additionalColors);

  const extras = (additionalColorNames ?? [])
    .filter((n) => n.trim() !== "")
    .slice(0, 3)
    .map(
      (name) =>
        stored.find((c) => c.name === name)?.hex ??
        COLORS.find((c) => c.name === name)?.hex ??
        null,
    );

  if (extras.length === 0) {
    return (
      <span
        aria-hidden
        className={`block rounded-t-[7px] border-b-[3px] border-ink ${className}`}
        style={{ background: colorHex, height: 8 }}
      />
    );
  }

  return (
    <span aria-hidden className={`flex overflow-hidden rounded-t-[7px] border-b-[3px] border-ink ${className}`} style={{ height: 8 }}>
      {[{ hex: colorHex as string | null }, ...extras.map((hex) => ({ hex }))].map((band, i) => (
        <span
          key={i}
          className="h-full"
          style={{
            flex: 1,
            background: band.hex ?? "#eaecee",
            borderLeft: i > 0 ? "2px solid #1b2126" : undefined,
          }}
        />
      ))}
    </span>
  );
}
