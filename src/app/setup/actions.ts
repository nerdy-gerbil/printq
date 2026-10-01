"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  USERNAME_RULE,
} from "@/lib/auth-rules";
import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import { initialsFor } from "@/lib/tokens";
import { isUniqueViolation } from "@/lib/invites";

/**
 * The first-run bootstrap.
 *
 * While no user with the admin role exists, /setup is claimable by whoever
 * reaches it — that is the deployment's owner, the only person with the URL.
 * The moment an admin exists the page answers 404 and the action refuses, so
 * the window is exactly "before the printer has an owner".
 *
 * The user row and the credential account are written the way Better Auth
 * itself writes them — `issuer: "local:credential"`, `accountId: userId`,
 * and the library's own scrypt digest — so sign-in cannot tell this account
 * was not created by Better Auth. `better-auth/crypto` is the same module the
 * credential plugin calls; there is no second password format to maintain.
 *
 * Email verification is stamped true: this is the one address that was never
 * invited, and nothing in the app mails the admin anything.
 */

const SetupSchema = z.object({
  name: z.string().trim().min(1, "Say who you are.").max(80, "Keep it short."),
  email: z.email("That does not look like an email address."),
  username: z
    .string()
    .trim()
    .min(USERNAME_MIN, `A username needs at least ${USERNAME_MIN} characters.`)
    .max(USERNAME_MAX, `A username can be at most ${USERNAME_MAX} characters.`)
    .regex(USERNAME_PATTERN, USERNAME_RULE),
  password: z
    .string()
    .min(PASSWORD_MIN, `A password needs at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `That password is longer than ${PASSWORD_MAX} characters.`),
});

export type SetupState = { error?: string; field?: "name" | "email" | "username" | "password" };

/** True while this deployment still has no administrator. */
export async function needsSetup(): Promise<boolean> {
  const count = await db.user.count({ where: { role: "admin" } });
  return count === 0;
}

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  // Re-checked here, not just on the page: rendering is not authorisation.
  if (!(await needsSetup())) {
    return { error: "PrintQ - Requests is already set up. Sign in instead." };
  }

  const parsed = SetupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue?.message ?? "Check the form.",
      field: issue?.path[0] as SetupState["field"],
    };
  }

  const name = parsed.data.name;
  const email = parsed.data.email.trim().toLowerCase();

  // The HIBP breach check (haveIBeenPwned plugin) is not on this path, so the
  // same rule is applied here: a credential refuses to be a known-breach
  // password. K-anonymity — five characters of a SHA-1 prefix leave the box.
  const sha1 = (await import("node:crypto")).createHash("sha1");
  sha1.update(parsed.data.password);
  const prefix = sha1.digest("hex").toUpperCase().slice(0, 5);
  const suffix = sha1.digest("hex").toUpperCase().slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`hibp status ${res.status}`);
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hash, count] = line.trim().split(":");
      if (hash === suffix && Number(count) > 0) {
        return {
          error:
            "That password appears in a known breach. Pick another — length beats cleverness.",
          field: "password",
        };
      }
    }
  } catch (error) {
    // Upstream fails closed for registrations; setup follows, because this
    // credential is the most powerful one the deployment will ever hold.
    console.error("[setup] breach check failed", error);
    return {
      error:
        "The password breach check could not be reached. Try again in a moment, or set HIBP_DISABLED=true only if this host has no outbound internet.",
      field: "password",
    };
  }

  let userId: string;
  try {
    const digest = await hashPassword(parsed.data.password);
    userId = (await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          emailVerified: true,
          initials: initialsFor(name),
          role: "admin",
          invitedById: null,
        },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          accountId: user.id,
          issuer: "local:credential",
          providerId: "credential",
          userId: user.id,
          password: digest,
        },
      });
      return user.id;
    })) as string;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "That email or username is already taken.", field: "email" };
    }
    console.error("[setup] bootstrap failed", error);
    return { error: "That did not go through. Try again in a moment." };
  }

  await record({
    action: "admin.bootstrapped",
    actor: { id: userId, email },
    subject: email,
    detail: { name, via: "first-run setup" },
  });

  redirect("/signin?setup=1");
}
