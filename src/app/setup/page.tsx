import { redirect } from "next/navigation";

import { currentUser } from "@/lib/authz";
import { Brand, Kicker } from "@/components/ui";
import { PASSWORD_MIN, USERNAME_RULE } from "@/lib/auth-rules";
import { completeSetup, needsSetup } from "./actions";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/**
 * The first-run page.
 *
 * Reachable only while the deployment has no administrator: the page checks,
 * the action checks again, and the middleware keeps it out of the signed-in
 * redirect flow. Whoever lands here on a fresh deployment owns the printer —
 * which is exactly the deployment's owner, and nobody else, because the URL
 * is not discoverable and the window closes the moment they finish.
 */
export default async function SetupPage() {
  // A signed-in visitor has no business here — the app is either set up
  // (they go home) or somehow not (the action would refuse anyway).
  // `currentUser` rather than `requireUser`: the latter redirects by throwing,
  // and the whole point here is to fall through for anonymous visitors.
  if (await currentUser()) redirect("/board");

  if (!(await needsSetup())) {
    // Not a 404 on purpose: the honest sentence beats a lost visitor, and the
    // route's existence is already documented in the README quick start.
    redirect("/signin");
  }


  return (
    <main className="mx-auto w-full max-w-[560px] px-[26.4px] pb-[80px] pt-[52.8px]">
      <div className="mb-[26.4px] flex items-center gap-[13.2px]">
        <Brand size={40} />
      </div>
      <Kicker>First run</Kicker>
      <h1 className="m-0 mb-[13.2px] text-[40px] leading-[1] text-ink">
        Claim the printer
      </h1>
      <p className="m-0 mb-[26.4px] text-[15.5px] leading-[1.5] text-ink-2 text-pretty">
        This is the one-time setup for PrintQ - Requests. The account you create
        here is the first administrator. Everyone else arrives later, by
        invitation, from the guest list.
      </p>

      <SetupForm
        passwordMin={PASSWORD_MIN}
        usernameRule={USERNAME_RULE}
        action={completeSetup}
      />
    </main>
  );
}
