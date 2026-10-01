import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { db } from "@/lib/db";
import { currentUser } from "@/lib/authz";
import { openModel } from "@/lib/storage";

/**
 * A cached wishlist thumbnail, streamed through the app.
 *
 * The same shape as `/api/models/[id]`: the bytes live on the models volume,
 * out of the web root, and the route is the gate. Session required — the
 * wishlist is an admin screen, so any signed-in account may see the picture,
 * but a stranger may not. `Cache-Control: private` keeps a shared cache from
 * holding a copy.
 *
 * The content type is derived from the stored extension and confined to the
 * `image/*` this route ever wrote — a thumbnail key is never user input (the
 * URL is, but the stored image was validated as `image/*` when cached), and
 * `X-Content-Type-Options: nosniff` closes the guessing game anyway.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only types the wishlist's fetcher ever caches — keys of `IMAGE_EXT` there. */
const IMG_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const { id } = await params;

  const row = await db.wishlistItem.findUnique({
    where: { id },
    select: { thumbnailKey: true },
  });
  if (!row || !row.thumbnailKey) return new NextResponse(null, { status: 404 });

  let file;
  try {
    file = await openModel(row.thumbnailKey);
  } catch (error) {
    console.error("[wishlist-thumb] storage read failed", error);
    return new NextResponse(null, { status: 502 });
  }
  if (!file) {
    console.error("[wishlist-thumb] row names a picture that is not on disk", row.thumbnailKey);
    return new NextResponse(null, { status: 502 });
  }

  const ext = row.thumbnailKey.split(".").pop()?.toLowerCase() ?? "";
  const mime = IMG_MIME[ext];
  if (!mime || !mime.startsWith("image/")) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Readable.toWeb(file.stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(file.size),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
