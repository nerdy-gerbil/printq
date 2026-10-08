/**
 * The geometry scan, in one place for both sides of the upload.
 *
 * The server has to measure whatever bytes actually arrived, and the upload
 * form has to put a price on a file the requester has not sent yet. Both need
 * the same arithmetic, and two copies of a mesh scan is how a form and a server
 * come to disagree about the same file — so the bounding box and the volume are
 * computed here, in code with no `fflate` in it and no `server-only` on it.
 * `models.ts` (which does import `fflate`, for 3MF) uses these functions for the
 * STL formats and keeps the archive handling to itself; the upload form imports
 * only this file, which is why the parser never reaches the browser bundle.
 *
 * The volume is the sum, over every triangle, of `v0 · (v1 × v2) / 6` — the
 * signed volume of the tetrahedron that triangle forms with the origin. For a
 * closed, consistently wound surface those signed pieces cancel exactly outside
 * the solid and add up to the volume it encloses, which is what every STL out
 * of a slicer is. On a mesh that is open, or wound every which way, the sum is
 * meaningless, so it is only reported when it is plausible: positive, and no
 * larger than the box that contains it. A caller handed `null` has to show no
 * number rather than a guess — see `estimate.ts` for what happens next.
 */
import { MAX_TRIANGLES } from "@/lib/upload-limits";

export type Box = {
  min: [number, number, number];
  max: [number, number, number];
};

export const emptyBox = (): Box => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});

export function expand(box: Box, x: number, y: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  const p = [x, y, z] as const;
  for (let i = 0; i < 3; i++) {
    if (p[i]! < box.min[i]!) box.min[i] = p[i]!;
    if (p[i]! > box.max[i]!) box.max[i] = p[i]!;
  }
}

/** The box's own volume. An upper bound on any closed mesh inside it. */
export function boxVolumeMm3(box: Box): number {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite)) return 0;
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) * Math.max(0, z1 - z0);
}

export type MeshScan = {
  box: Box;
  triangles: number;
  /** Enclosed volume in mm³, or null when the mesh cannot support the claim. */
  volumeMm3: number | null;
};

/**
 * A binary STL has no magic number, so it is identified structurally: an
 * 80-byte header, a uint32 triangle count, then exactly 50 bytes per triangle.
 * If the arithmetic lands on the file length, it is a binary STL and nothing
 * else plausibly is.
 *
 * This check has to come first, because binary STLs written by some tools begin
 * with the ASCII word "solid" in their header and would otherwise be mistaken
 * for the text format.
 */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (count > MAX_TRIANGLES) return false;
  return bytes.length === 84 + count * 50;
}

export function isAsciiStl(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 2048))
    .trimStart()
    .toLowerCase();
  // Both markers required: "solid" alone is too weak a signal.
  return head.startsWith("solid") && head.includes("facet normal");
}

/**
 * Turn a raw signed sum into a number worth showing, or null.
 *
 * Both guards earn their place. A zero or negative total means the surface
 * enclosed nothing (a shell, a flat sheet, or a mesh wound the other way), and
 * a total larger than the bounding box means the surface is not closed — a
 * solid cannot be bigger than the box it fits in, and anything that claims to
 * be is the signature of the open-mesh arithmetic falling apart.
 */
export function enclosedVolume(signed: number, box: Box): number | null {
  const volume = Math.abs(signed);
  if (!Number.isFinite(volume) || volume <= 0) return null;
  const ceiling = boxVolumeMm3(box);
  if (ceiling > 0 && volume > ceiling * 1.0005) return null;
  return Math.round(volume * 10) / 10;
}

export function scanBinaryStl(bytes: Uint8Array): MeshScan {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const box = emptyBox();
  let signed = 0;
  let offset = 84;
  for (let t = 0; t < triangles; t++) {
    // Skip the 12-byte normal; only the three vertices carry the geometry.
    const points: Array<[number, number, number]> = [];
    for (let v = 0; v < 3; v++) {
      const base = offset + 12 + v * 12;
      const x = view.getFloat32(base, true);
      const y = view.getFloat32(base + 4, true);
      const z = view.getFloat32(base + 8, true);
      expand(box, x, y, z);
      points.push([x, y, z]);
    }
    signed += tetrahedron(points[0]!, points[1]!, points[2]!);
    offset += 50;
  }
  return { box, triangles, volumeMm3: enclosedVolume(signed, box) };
}

export function scanAsciiStl(bytes: Uint8Array): MeshScan {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const box = emptyBox();
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let vertices = 0;
  let signed = 0;
  let points: Array<[number, number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const x = parseFloat(m[1]!);
    const y = parseFloat(m[2]!);
    const z = parseFloat(m[3]!);
    expand(box, x, y, z);
    points.push([x, y, z]);
    vertices++;
    // Every third vertex closes a facet, which is the unit the volume adds up
    // in — the same grouping the triangle count is derived from.
    if (points.length === 3) {
      signed += tetrahedron(points[0]!, points[1]!, points[2]!);
      points = [];
    }
  }
  return {
    box,
    triangles: Math.floor(vertices / 3),
    volumeMm3: enclosedVolume(signed, box),
  };
}

/** v0 · (v1 × v2) / 6 — one triangle's signed piece of the enclosed volume. */
export function tetrahedron(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const cross = [
    b[1] * c[2] - b[2] * c[1],
    b[2] * c[0] - b[0] * c[2],
    b[0] * c[1] - b[1] * c[0],
  ];
  const dot = a[0] * cross[0]! + a[1] * cross[1]! + a[2] * cross[2]!;
  return dot / 6;
}

/** Sniff and scan an STL, in the order `models.ts` validates it. */
export function scanStl(bytes: Uint8Array): MeshScan | null {
  if (isBinaryStl(bytes)) return scanBinaryStl(bytes);
  if (isAsciiStl(bytes)) return scanAsciiStl(bytes);
  return null;
}
