/**
 * What an upload is likely to cost, from what the app actually measured.
 *
 * Three steps, and it is worth being clear which of them is a measurement and
 * which is an assumption, because they are not equally trustworthy:
 *
 * 1. The volume is measured — `mesh.ts` sums the enclosed volume of the mesh
 *    the file contains. That is geometry, not a guess.
 * 2. The material is assumed. A printed part is mostly air inside, so the
 *    enclosed volume is scaled by an infill the owner sets, and the result is
 *    turned into grams by the material's own density. Wall count, supports,
 *    layer height and the slicer's own choices all move this number, which is
 *    why it says "about" wherever it is shown.
 * 3. The time is assumed twice over — a print speed in mm³/s is the second
 *    assumption — and a price follows from the two rates the shop already has.
 *
 * The rule this module does not break: nothing here is ever written down as
 * what a print cost. `cost.ts` derives the real figure from grams weighed and
 * minutes on the bed, measured by the team. An estimate is what a requester
 * sees before the print exists, and it says so.
 *
 * This file is deliberately free of `server-only`, of the database and of any
 * parser: the upload form prices a file in the browser with it, and the ticket
 * prices one on the server, and both must agree. That is also why the markup
 * and the floor are computed here and imported by `cost.ts` rather than written
 * out twice.
 */

/** Consumer filament. Fixed because the app prints 1.75 mm stock. */
export const FILAMENT_DIAMETER_MM = 1.75;

/**
 * "3 h 25 m" / "48 m" — minutes as a person reads them.
 *
 * Lives here rather than in `cost.ts` so the upload form can print an
 * estimated print time in the same words the ledger prints a measured one —
 * `cost.ts` reaches the database, and this file is the half that does not.
 */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} m`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type MaterialUse = {
  /** The material volume a print would use, in mm³. */
  printedMm3: number;
  grams: number;
  /** Filament length in metres, at 1.75 mm stock. */
  metres: number;
  minutes: number;
};

/**
 * Volume in, filament and time out — or null when there is no volume to work
 * from, which is the case for a mesh whose surface is not closed.
 */
export function materialFromVolume(input: {
  volumeMm3: number | null;
  densityGcm3: number;
  infillPercent: number;
  flowMm3s: number;
}): MaterialUse | null {
  const { volumeMm3, densityGcm3, infillPercent, flowMm3s } = input;
  if (volumeMm3 == null || !(volumeMm3 > 0)) return null;
  if (!(densityGcm3 > 0)) return null;

  // The infill is the assumption that matters most — it is the difference
  // between a solid block and a shell with a lattice inside — so it is clamped
  // rather than trusted, and the caller reports which figure it used.
  const infill = Math.min(100, Math.max(5, infillPercent)) / 100;
  const printedMm3 = volumeMm3 * infill;

  const cm3 = printedMm3 / 1000;
  const grams = cm3 * densityGcm3;

  // Length follows from the cross-section of the filament, not from its mass:
  // a metre of PLA and a metre of resin filament weigh different amounts.
  const radiusCm = FILAMENT_DIAMETER_MM / 20;
  const areaCm2 = Math.PI * radiusCm * radiusCm;
  const metres = areaCm2 > 0 ? cm3 / areaCm2 / 100 : 0;

  const minutes = flowMm3s > 0 ? printedMm3 / flowMm3s / 60 : 0;

  return { printedMm3, grams: round1(grams), metres: round1(metres), minutes: Math.round(minutes) };
}

export type PricedCost = {
  /** Filament + machine. */
  subtotal: number;
  markup: number;
  price: number;
  minimumApplied: boolean;
};

/**
 * The shop's pricing rule, in one place: cost plus a markup, never below the
 * floor. `deriveCost` in `cost.ts` calls this for a measured print and the
 * estimate calls it for a guessed one, so the two can never disagree about what
 * the shop charges — which they would, eventually, if the arithmetic lived in
 * both files.
 */
export function priceFromCost(input: {
  filament: number;
  machine: number;
  markupPercent?: number;
  minimumCharge?: number;
}): PricedCost {
  const subtotal = input.filament + input.machine;
  const markupPercent = input.markupPercent ?? 0;
  const minimumCharge = input.minimumCharge ?? 0;

  const markup = subtotal * (markupPercent / 100);
  const marked = subtotal + markup;
  const minimumApplied = minimumCharge > 0 && marked < minimumCharge;

  return {
    subtotal,
    markup,
    price: minimumApplied ? minimumCharge : marked,
    minimumApplied,
  };
}

export type Estimate = MaterialUse & {
  /** What the material and the machine would come to, at today's rates. */
  filament: number;
  machine: number;
  subtotal: number;
  markup: number;
  price: number;
  minimumApplied: boolean;
  /** The basis, so a caller can say how it was worked out. */
  infillPercent: number;
  densityGcm3: number;
  dollarsPerKg: number;
  dollarsPerHour: number;
};

/**
 * The whole estimate: a measured volume, the assumptions, and the shop's own
 * rates and pricing rule. Null when there is nothing honest to say — no volume,
 * or a rate of zero on both sides, which would report a price of nothing for a
 * print that costs something.
 */
export function estimatePrint(input: {
  volumeMm3: number | null;
  densityGcm3: number;
  infillPercent: number;
  flowMm3s: number;
  dollarsPerKg: number;
  dollarsPerHour: number;
  markupPercent?: number;
  minimumCharge?: number;
}): Estimate | null {
  const use = materialFromVolume(input);
  if (!use) return null;

  const dollarsPerKg = Math.max(0, input.dollarsPerKg);
  const dollarsPerHour = Math.max(0, input.dollarsPerHour);
  if (dollarsPerKg === 0 && dollarsPerHour === 0) return null;

  const filament = (use.grams / 1000) * dollarsPerKg;
  const machine = (use.minutes / 60) * dollarsPerHour;
  const priced = priceFromCost({
    filament,
    machine,
    markupPercent: input.markupPercent,
    minimumCharge: input.minimumCharge,
  });

  return {
    ...use,
    filament: round2(filament),
    machine: round2(machine),
    subtotal: round2(priced.subtotal),
    markup: round2(priced.markup),
    price: round2(priced.price),
    minimumApplied: priced.minimumApplied,
    infillPercent: Math.min(100, Math.max(5, input.infillPercent)),
    densityGcm3: input.densityGcm3,
    dollarsPerKg,
    dollarsPerHour,
  };
}
