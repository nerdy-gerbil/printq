import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isTeam, storyScope, type Actor } from "@/lib/scope";

// The pure rules live in `scope.ts` so they can be imported without pulling in
// `server-only`. Re-exported here so callers have one import to reach for.
export {
  storyScope,
  storyRef,
  FLOW,
  BOARD,
  isTerminal,
  nextStatus,
  assertTransition,
  AuthzError,
  isTeam,
  TEAM_ROLES,
  // feature-request rules (the 'frr' track)
  featureScope,
  featureRef,
  featureLabel,
  FEATURE_FLOW,
  FEATURE_BOARD,
  isFeatureTerminal,
  nextFeatureStatus,
  assertFeatureTransition,
  type Actor,
} from "@/lib/scope";

/**
 * The signed-in user, or null. Never throws.
 *
 * Suspension is checked here as well as at sign-in, and the redundancy is the
 * point. The admin plugin refuses to *create* a session for a suspended
 * account, which stops them getting back in but does nothing about the
 * session they already hold — that one keeps working until it expires.
 * Revoking access deletes those sessions, and this is the belt to that
 * braces: a session that somehow survives still resolves to nobody.
 */
export async function currentUser(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const u = session.user as typeof session.user & {
    initials?: string | null;
    role?: string | null;
    banned?: boolean | null;
  };

  if (u.banned) return null;

  const role: Actor["role"] =
    u.role === "admin" ? "admin" : u.role === "manager" ? "manager" : "user";

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    initials: u.initials ?? "??",
    role,
  };
}

/**
 * Gate for any page or action that needs an account. Sends people to sign-in
 * with a return path so the invite/e-mail round trip lands where they meant
 * to go.
 */
export async function requireUser(returnTo?: string): Promise<Actor> {
  const user = await currentUser();
  if (user) return user;

  const target = returnTo
    ? `/signin?next=${encodeURIComponent(returnTo)}`
    : "/signin";
  redirect(target);
}

/**
 * Gate for admin-only surfaces (invites, members, benefits, materials,
 * rates, audit, wishlist).
 *
 * Answers 404 rather than 403 on purpose: a client poking at /admin/invites
 * learns nothing about whether that route exists.
 */
export async function requireAdmin(): Promise<Actor> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

/**
 * Gate for print-team surfaces — the queue and the frr triage queue.
 * Managers work the queue alongside admins; ordinary users get a 404, same
 * reasoning as `requireAdmin`.
 */
export async function requireManager(): Promise<Actor> {
  const user = await requireUser();
  if (!isTeam(user)) notFound();
  return user;
}

/**
 * Fetch one story under the caller's scope. A client asking for somebody
 * else's story gets a 404, not a 403 — a 403 would confirm the story exists.
 */
export async function getStoryOr404(storyId: number, actor: Actor) {
  const story = await db.story.findFirst({
    where: { AND: [{ id: storyId }, storyScope(actor)] },
    include: {
      uploader: { select: { id: true, name: true, initials: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true, initials: true, role: true } },
        },
      },
    },
  });
  if (!story) notFound();
  return story;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * The print team — every admin and manager. Upload and status notifications
 * fan out to all of them, since any of them can pick the ticket up.
 */
export async function printTeam(): Promise<Actor[]> {
  const rows = await db.user.findMany({
    where: { role: { in: ["admin", "manager"] }, banned: false },
    select: { id: true, name: true, email: true, initials: true, role: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    initials: r.initials,
    role: r.role as Actor["role"],
  }));
}

/**
 * Copy for the people who work the queue — "Send it to the print team",
 * "what's in it for the team?". The handoff wrote it as the owner's first
 * name; with a team rather than one owner, a role name is the honest form.
 *
 * Only ever rendered behind a session. Unauthenticated pages stay generic
 * rather than telling a stranger who runs the printer.
 */
export const printerName = cache(async (): Promise<string> => "the print team");

export async function notify(opts: {
  recipientId: string;
  storyId?: number;
  /** A feature request this is about, for the 'frr' track. */
  featureId?: number;
  text: string;
}): Promise<void> {
  await db.notification.create({
    data: {
      recipientId: opts.recipientId,
      storyId: opts.storyId ?? null,
      featureId: opts.featureId ?? null,
      text: opts.text,
    },
  });
}

/**
 * Tell the whole print team — everyone who can work the ticket — skipping the
 * actor when they are on the team themselves (their own action is the source,
 * not news). A user's action reaches everyone on the team.
 */
export async function notifyTeam(
  actor: Actor,
  text: string,
  refs: { storyId?: number; featureId?: number } = {},
): Promise<void> {
  const team = await printTeam();
  const targets = team.filter((m) => m.id !== actor.id);
  if (targets.length === 0) return;
  await db.notification.createMany({
    data: targets.map((m) => ({
      recipientId: m.id,
      storyId: refs.storyId ?? null,
      featureId: refs.featureId ?? null,
      text,
    })),
  });
}

/** Notifications are per recipient, and scoped the same way stories are. */
export function unreadCount(actor: Actor) {
  return db.notification.count({
    where: { recipientId: actor.id, read: false },
  });
}
