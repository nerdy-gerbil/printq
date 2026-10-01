import { COLORS } from "@/lib/catalog";

/**
 * The filament stripe on a ticket, worn down the left edge the way an order
 * gets colour-coded.
 *
 * A multi-colour print asks for more than one spool, so the stripe carries
 * them all: the primary colour first, then the extras in the order the
 * requester numbered them, sliced into equal bands. Extra names come from
 * the requester and a requester cannot add a hex, so the bands wear the
 * palette's swatch for the name — an unknown name falls back to the pale
 * "unset" swatch, which reads as "asked-for, not stocked" rather than
 * pretending to be a colour.
 *
 * Rendered as stacked flex children rather than a single gradient: hard
 * edges between bands are the point — three spools, three bands.
 */
export function ColourStripe({
  colorHex,
  additionalColorNames,
  className = "",
}: {
  colorHex: string;
  additionalColorNames?: string[] | null;
  className?: string;
}) {
  const extras = (additionalColorNames ?? [])
    .filter((n) => n.trim() !== "")
    .slice(0, 3)
    .map((name) => COLORS.find((c) => c.name === name)?.hex ?? null);

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
