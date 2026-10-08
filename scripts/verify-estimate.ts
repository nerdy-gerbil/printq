/**
 * Checks the print estimate: a measured mesh volume turned into filament, a
 * print time and a price.
 *
 *   npm run verify:estimate
 *
 * No server and no database — everything asserted here is pure arithmetic in
 * `src/lib/estimate.ts` and `src/lib/mesh.ts`, which is exactly why it can be
 * checked this way. The two modules are also the only pair in the app that runs
 * in the browser as well as on the server, so this suite is the one place that
 * pins down what a requester is actually shown.
 */
import { estimatePrint, materialFromVolume, priceFromCost } from "../src/lib/estimate";
import { scanStl } from "../src/lib/mesh";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  console.info(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  ok ? passed++ : failures.push(name);
}
const section = (t: string) => console.info(`\n── ${t} ${"─".repeat(Math.max(0, 52 - t.length))}`);

/** The twelve triangles of a closed box from the origin to (x, y, z). */
function boxFaces(): number[][] {
  return [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
}

/**
 * An axis-aligned box as a triangle soup, optionally shifted along y so two of
 * them can be joined into an L.
 */
function boxTris(x: number, y: number, z: number, shiftY = 0): number[][] {
  const p = [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ].map(([px, py, pz]) => [px!, py! + shiftY, pz!]);
  return boxFaces().map((f) => f.flatMap((i) => p[i]!));
}

/** A binary STL of one closed box, or of several joined into a solid. */
function binaryStl(x: number, y: number, z: number, ...more: number[][][]): Uint8Array {
  const tris = [boxTris(x, y, z), ...more].flat();
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

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------

section("the volume comes from the mesh, not from its bounding box");

const cube = scanStl(binaryStl(40, 40, 40));
check("a closed 40 mm cube measures 64000 mm³", cube?.volumeMm3 === 64000, String(cube?.volumeMm3));

// An L: a 200 × 10 × 10 bar with a 10 × 190 × 10 upright on its end. The two
// solids only touch along a face, so the signed sum is their union: 39000 mm³
// inside a 200 × 200 × 10 mm box of 400000. A bounding box cannot tell that
// from a solid slab — and a solid slab is what this must not report.
const l = scanStl(binaryStl(200, 10, 10, boxTris(10, 190, 10, 10)));
check("an L-shaped solid measures its own volume (20000 + 19000)",
      l?.volumeMm3 === 39000, String(l?.volumeMm3));
check("which is not the volume of the box around it", l?.volumeMm3 !== 200 * 200 * 10,
      String(l?.volumeMm3));

// Not a model at all: nothing measurable, and no crash.
check("a file that is not an STL scans to nothing", scanStl(new Uint8Array(200)) === null);

section("volume and density become filament");

const use = materialFromVolume({
  volumeMm3: 64000,
  densityGcm3: 1.24, // PLA
  infillPercent: 20,
  flowMm3s: 8,
});
// 64000 mm³ × 20% = 12800 mm³ = 12.8 cm³ × 1.24 g/cm³ = 15.9 g, and 12.8 cm³ of
// 1.75 mm filament is 12.8 / 0.024052 cm² = 532 cm = 5.3 m.
check("20% of a 64 cm³ cube weighs 15.9 g of PLA", use?.grams === 15.9, String(use?.grams));
check("which is 5.3 m of 1.75 mm filament", use?.metres === 5.3, String(use?.metres));
check("and takes about 27 minutes at 8 mm³/s", use?.minutes === 27, String(use?.minutes));

const petg = materialFromVolume({ volumeMm3: 64000, densityGcm3: 1.27, infillPercent: 20, flowMm3s: 8 });
check("PETG, denser than PLA, weighs more for the same mesh",
      (petg?.grams ?? 0) > (use?.grams ?? 0), `${petg?.grams} vs ${use?.grams}`);

const solid = materialFromVolume({ volumeMm3: 64000, densityGcm3: 1.24, infillPercent: 100, flowMm3s: 8 });
check("a solid part uses five times the filament of a 20% one",
      Math.abs((solid?.grams ?? 0) - (use?.grams ?? 0) * 5) < 0.1,
      `${solid?.grams} vs ${use?.grams}`);

// The assumption is clamped rather than trusted: a nonsense infill must not
// produce a nonsense price.
const clampedLow = materialFromVolume({ volumeMm3: 64000, densityGcm3: 1.24, infillPercent: 0, flowMm3s: 8 });
const atFive = materialFromVolume({ volumeMm3: 64000, densityGcm3: 1.24, infillPercent: 5, flowMm3s: 8 });
check("an infill of zero is read as the floor, not as free", clampedLow?.grams === atFive?.grams,
      `${clampedLow?.grams} vs ${atFive?.grams}`);

section("nothing honest to say means no number at all");

check("no volume, no estimate",
      materialFromVolume({ volumeMm3: null, densityGcm3: 1.24, infillPercent: 20, flowMm3s: 8 }) === null);
check("no density, no estimate",
      materialFromVolume({ volumeMm3: 64000, densityGcm3: 0, infillPercent: 20, flowMm3s: 8 }) === null);
check("and a whole estimate for an unmeasurable mesh is null",
      estimatePrint({ volumeMm3: null, densityGcm3: 1.24, infillPercent: 20, flowMm3s: 8,
                      dollarsPerKg: 20, dollarsPerHour: 0.75 }) === null);
check("with both rates at zero there is no price to show",
      estimatePrint({ volumeMm3: 64000, densityGcm3: 1.24, infillPercent: 20, flowMm3s: 8,
                      dollarsPerKg: 0, dollarsPerHour: 0 }) === null);

section("the shop's pricing rule is one rule");

const cost = priceFromCost({ filament: 0.32, machine: 0.34, markupPercent: 25, minimumCharge: 0 });
check("a markup is added on top of cost", round2(cost.price) === 0.83, String(cost.price));
check("and reported separately, so the ticket can show its working",
      round2(cost.subtotal) === 0.66 && round2(cost.markup) === 0.17,
      `${cost.subtotal} + ${cost.markup}`);

const floored = priceFromCost({ filament: 0.32, machine: 0.34, markupPercent: 0, minimumCharge: 5 });
check("a minimum charge lifts a small job to the floor", floored.price === 5 && floored.minimumApplied);
const aboveFloor = priceFromCost({ filament: 30, machine: 20, markupPercent: 0, minimumCharge: 5 });
check("and leaves a bigger one alone", aboveFloor.price === 50 && !aboveFloor.minimumApplied);

section("the estimate a requester sees");

const priced = estimatePrint({
  volumeMm3: 64000,
  densityGcm3: 1.24,
  infillPercent: 20,
  flowMm3s: 8,
  dollarsPerKg: 20,
  dollarsPerHour: 0.75,
  markupPercent: 25,
  minimumCharge: 0,
});
// 15.9 g at 20 $/kg = 0.318, 27 minutes at 0.75 $/h = 0.3375, subtotal
// 0.6555, +25% = 0.819375. Nothing is rounded until the end, so the answer is
// 0.82 — not the 0.83 you get by rounding the two halves first, which is the
// kind of penny a receipt would rather not argue about.
check("a PLA cube is priced from its own geometry", priced?.price === 0.82, String(priced?.price));
check("the material's own rate is what it is priced at",
      priced?.dollarsPerKg === 20 && priced?.densityGcm3 === 1.24);
check("and it says which assumptions it used",
      priced?.infillPercent === 20, String(priced?.infillPercent));

const expensive = estimatePrint({
  volumeMm3: 64000, densityGcm3: 1.24, infillPercent: 20, flowMm3s: 8,
  dollarsPerKg: 40, dollarsPerHour: 0.75, markupPercent: 0, minimumCharge: 0,
});
check("raising a material's price raises the estimate",
      (expensive?.price ?? 0) > (priced?.price ?? 0), `${expensive?.price} vs ${priced?.price}`);

console.info(
  `\n${passed} checks passed, ${failures.length} failed` +
    (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
);
process.exitCode = failures.length ? 1 : 0;
