/**
 * The admin placeholder the reconciliation leaves behind for `/setup`.
 *
 * Why this is a module and not four lines inside a transaction callback: the
 * original built the account row with `accountId: userId`, referring to the
 * `const userId` that the very same callback was in the middle of initialising.
 * That is a temporal dead zone, not a typo, and it threw
 *
 *     ReferenceError: Cannot access 'userId' before initialization
 *
 * on the first deploy that got that far — *after* deleting the broken admin, so
 * the database was left with no admin at all. The id now comes from the row that
 * was just created, and both writes are injected functions so
 * `scripts/verify-ddl.ts` can drive the sequence with fakes and assert that the
 * account row is keyed by the new user's id.
 *
 * The shape mirrors what `/setup` writes: a `credential` account with no
 * password yet, so Better Auth accepts the sign-in once `/setup` has populated
 * the digest. Nothing here invents a password.
 */

export type AdminPlaceholder = {
  name: string;
  email: string;
  initials: string;
};

/** The user row, as much of it as this needs back. */
export type CreatedUser = { id: string };

/** What the caller's `user.create` must accept. */
export type AdminUserData = {
  name: string;
  email: string;
  emailVerified: boolean;
  initials: string;
  role: "admin";
  invitedById: null;
};

/**
 * Two-letter initials for the avatar, uppercased, non-letters folded to `?`.
 * Unchanged from the inline version that wrote the existing rows.
 */
export function initialsFor(name: string): string {
  return name
    .toUpperCase()
    .slice(0, 2)
    .replace(/[^A-Z]/g, "?");
}

/**
 * Create the admin's user row and its credential account, in that order, and
 * return the new user's id. Both writes are supplied by the caller so this can
 * run inside a real `$transaction`, or against fakes in a test.
 */
export async function createAdminPlaceholder(
  admin: AdminPlaceholder,
  createUser: (data: AdminUserData) => Promise<CreatedUser>,
  createAccount: (accountId: string) => Promise<unknown>,
): Promise<string> {
  const user = await createUser({
    name: admin.name,
    email: admin.email,
    emailVerified: true,
    initials: admin.initials,
    role: "admin",
    invitedById: null,
  });
  await createAccount(user.id);
  return user.id;
}
