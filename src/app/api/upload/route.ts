import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { currentUser, notifyTeam, storyRef } from "@/lib/authz";
import type { Actor } from "@/lib/scope";
import { record } from "@/lib/audit";
import { WishSchema } from "@/lib/catalog";
import { activeColorsFor } from "@/lib/colors";
import { activeBenefitLabels } from "@/lib/benefits";
import { activeMaterialNames } from "@/lib/materials";
import {
  MAX_BYTES,
  REJECTION_COPY,
  extensionOf,
  formatBytes,
  inspectModel,
  safeFilename,
} from "@/lib/models";
import { getSettings } from "@/lib/settings";
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_QUEUED_UPLOADS,
  MAX_REQUEST_BYTES,
} from "@/lib/upload-limits";
import { MIME_FOR, ensureStorageRoot, putModel, storageKeyFor } from "@/lib/storage";

/**
 * Model upload.
 *
 * A route handler rather than a server action, for one reason: the browser
 * can watch a real XHR upload progress bar against this, and a large model
 * over office wifi is long enough that a spinner is not good enough.
 *
 * Order matters here. Nothing is written to storage until the bytes have
 * been inspected, and no story row exists until the object is in place — so
 * a rejected file leaves nothing behind, and a story never points at an
 * object that was not stored.
 */

export const runtime = "nodejs";
/** The whole file is buffered to measure its bounding box; do not cache. See
 *  the slot gate below for what keeps that buffering bounded. */
export const dynamic = "force-dynamic";

let storageReady: Promise<void> | null = null;

const bad = (status: number, error: string) =>
  NextResponse.json({ error }, { status });

/**
 * "That file is over 250.0 MB." — with the number the *owner* set, not the
 * compiled ceiling. Telling somebody their file is too big by a limit that is
 * not the one refusing it sends them looking for a smaller file for no reason.
 */
const tooLarge = (maxBytes: number) => `That file is over ${formatBytes(maxBytes)}.`;

/**
 * Only so many uploads are handled at once.
 *
 * This is what makes a 250 MB cap safe rather than hopeful. `request.formData()`
 * buffers the whole body before a line of this handler runs, so peak memory is
 * decided by how many large uploads overlap — nothing the validator does can
 * change that. Bounding the overlap bounds the memory, which is the "size-based
 * queue" the security audit named as one of the two answers. (The other,
 * a streaming parse, needs the file to stop arriving as multipart at all; see
 * docs/architecture.md.)
 *
 * A late arrival waits rather than being refused: somebody who has just spent a
 * minute pushing 200 MB up office wifi should not be told to start again. Only
 * once the queue itself is long does the app say no, because at that point the
 * honest answer is that it is busy.
 *
 * Per process. A second app instance has its own gate, which is the right
 * shape anyway — the memory it is protecting is also per process.
 */
let active = 0;
const waiting: Array<() => void> = [];

function acquireSlot(): Promise<boolean> {
  if (active < MAX_CONCURRENT_UPLOADS) {
    active++;
    return Promise.resolve(true);
  }
  if (waiting.length >= MAX_QUEUED_UPLOADS) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    waiting.push(() => {
      active++;
      resolve(true);
    });
  });
}

function releaseSlot(): void {
  active--;
  waiting.shift()?.();
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return bad(401, "Sign in first.");

  const settings = await getSettings();
  if (settings.ordersPaused) {
    // 503 rather than 403: nothing about this account is the problem, and the
    // form shows the owner's own words back to whoever tried.
    return bad(
      503,
      settings.pausedMessage.trim() ||
        "The printer is not taking new requests just now. Ask the team.",
    );
  }

  // The owner's cap can only lower the compiled one. next.config.ts fixes the
  // transport limit at build time, so a larger number here would be a promise
  // this server cannot keep — the body would be cut off mid-upload and the
  // file would look corrupt instead of oversized.
  const maxBytes = Math.min(settings.maxUploadMb * 1024 * 1024, MAX_BYTES);
  const maxRequestBytes = Math.min(Math.ceil(maxBytes * 1.2), MAX_REQUEST_BYTES);

  // Cheap rejection before reading a single byte of the body. The allowance
  // over the file cap is multipart's own overhead, and it matches the
  // transport limit in next.config.ts so that a file just over the cap is
  // answered "too large" rather than truncated into a parse failure.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxRequestBytes) {
    return bad(413, tooLarge(maxBytes));
  }

  // Taken *before* the body is read, because reading it is the expensive part.
  if (!(await acquireSlot())) {
    return bad(
      503,
      "Too many uploads at once — give it a moment and send it again.",
    );
  }
  try {
    return await handleUpload(request, user, maxBytes);
  } finally {
    releaseSlot();
  }
}

async function handleUpload(request: Request, user: Actor, maxBytes: number) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "That upload did not arrive intact. Try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad(400, "No file was attached.");
  if (file.size > maxBytes) return bad(413, tooLarge(maxBytes));

  const wish = WishSchema.safeParse({
    title: form.get("title") ?? "",
    material: form.get("material"),
    colorName: form.get("colorName"),
    quantity: form.get("quantity"),
    tip: form.get("tip"),
    note: form.get("note") ?? "",
    printSettings: form.get("printSettings") ?? "",
    additionalColorNames: form
      .getAll("additionalColorNames")
      .filter((v): v is string => typeof v === "string" && v !== "")
      .filter((v, i, a) => a.indexOf(v) === i),
    sourceUrl: form.get("sourceUrl") ?? "",
  });
  if (!wish.success) {
    return bad(400, wish.error.issues[0]?.message ?? "Check the form.");
  }

  // The tip and the material are both owner-managed data, so the lists — not
  // compile-time enums — decide. A retired or unknown value is refused here
  // even if the form somehow posted it. With no active benefits at all, any
  // non-empty tip is accepted rather than locking uploads out; materials have
  // seeded defaults, so an empty list is refused outright.
  const allowedTips = await activeBenefitLabels();
  if (allowedTips.length > 0 && !allowedTips.includes(wish.data.tip)) {
    return bad(400, "That is not a benefit on offer — pick one from the list.");
  }
  const allowedMaterials = await activeMaterialNames();
  if (!allowedMaterials.includes(wish.data.material)) {
    return bad(400, "That is not a material on offer — pick one from the list.");
  }
  // The colours on offer belong to the material — a spool of PLA is not stocked
  // in the shades a bottle of resin is — so the list is read for the material
  // this request names rather than from one list for the whole app. The read
  // falls back to the five built-in swatches for a material nobody has
  // configured yet, so this can only refuse a colour that is genuinely not on
  // the list rather than refusing everything on a fresh deployment.
  const palette = await activeColorsFor(wish.data.material);
  const primary = palette.find((c) => c.name === wish.data.colorName);
  if (!primary) {
    return bad(400, `That colour is not on offer in ${wish.data.material} — pick one from the list.`);
  }
  const extras: Array<{ name: string; hex: string }> = [];
  for (const name of wish.data.additionalColorNames) {
    const swatch = palette.find((c) => c.name === name);
    if (!swatch) {
      return bad(400, `“${name}” is not on offer in ${wish.data.material} — pick one from the list.`);
    }
    extras.push(swatch);
  }

  // Extra colours must be disjoint from the primary.
  if (wish.data.additionalColorNames.includes(wish.data.colorName)) {
    return bad(400, "The extra colours cannot repeat the primary colour.");
  }

  const filename = safeFilename(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Authoritative check. Whatever the browser allowed through, this is what
  // decides — extension, size and actual content all have to agree.
  const inspection = inspectModel(filename, bytes);
  if (!inspection.ok) {
    // A refused upload creates no story, so it gets its own verb. Repeated
    // rejections from one account are worth being able to see.
    await record({
      action: "upload.rejected",
      actor: user,
      subject: filename,
      detail: { reason: inspection.reason, bytes: bytes.length },
    });
    return bad(422, REJECTION_COPY[inspection.reason]);
  }

  const extension = extensionOf(filename);
  const key = storageKeyFor(extension);

  try {
    storageReady ??= ensureStorageRoot();
    await storageReady;
    await putModel(key, bytes);
  } catch (error) {
    storageReady = null; // let the next attempt retry creating the directory
    console.error("[upload] storage write failed", error);
    return bad(502, "The file could not be stored. Try again in a moment.");
  }

  const title = wish.data.title || filename.replace(/\.(stl|3mf)$/i, "");

  let story;
  try {
    story = await db.story.create({
      data: {
        title,
        uploaderId: user.id,
        status: "Requested",
        quantity: wish.data.quantity,
        material: wish.data.material,
        colorName: wish.data.colorName,
        colorHex: primary.hex,
        additionalColorNames: wish.data.additionalColorNames,
        // Both shapes on purpose: the names are the wire format the API and the
        // older rows use, and the swatches are what this ticket was actually
        // asked for, so a later change to the palette never rewrites it.
        additionalColors: extras.map(({ name, hex }) => ({ name, hex })),
        sourceUrl: wish.data.sourceUrl === "" ? null : wish.data.sourceUrl,
        tip: wish.data.tip,
        note: wish.data.note,
        printSettings: wish.data.printSettings,
        filename,
        fileSize: bytes.length,
        mimeType: MIME_FOR[extension] ?? "application/octet-stream",
        storageKey: key,
        dims: inspection.dims,
        // The measured volume, not an estimate of anything: what the mesh
        // encloses. Null for a surface that is not closed.
        volumeMm3: inspection.volumeMm3,
      },
    });
  } catch (error) {
    console.error("[upload] story insert failed", error);
    return bad(500, "The request could not be saved. Try again.");
  }

  // "every upload notifies the team"
  await notifyTeam(user, `${user.name} uploaded “${title}”.`, {
    storyId: story.id,
  });

  await record({
    action: "story.created",
    actor: user,
    subject: storyRef(story.id),
    detail: {
      title,
      filename,
      bytes: bytes.length,
      format: inspection.format,
      triangles: inspection.triangles,
      dims: inspection.dims,
      material: wish.data.material,
      quantity: wish.data.quantity,
    },
  });

  return NextResponse.json({
    id: story.id,
    ref: storyRef(story.id),
    title,
    dims: inspection.dims,
  });
}
