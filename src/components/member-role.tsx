"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setMemberRoleAction, type InviteFormState } from "@/app/admin/invites/actions";
import { Notice } from "@/components/ui";

const LEVELS = [
  { value: "user", label: "User" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-aqua px-[15px] py-[6px] font-mono text-[11.5px] font-bold uppercase text-ink hover:bg-sun disabled:opacity-50"
    >
      {pending ? "Saving…" : "Set level"}
    </button>
  );
}

/**
 * Change a member's access level — user, manager or admin.
 *
 * Behind a disclosure like the other member controls: it is not an everyday
 * action, and it takes effect on their next request (their current session
 * keeps its already-loaded role until the next navigation, which is fine —
 * every service call re-checks the role server-side anyway).
 */
export function MemberRole({
  userId,
  role,
  self,
}: {
  userId: string;
  role: "user" | "manager" | "admin";
  /** The signed-in admin viewing this row — their own control is disabled. */
  self: boolean;
}) {
  const [state, formAction] = useActionState<InviteFormState, FormData>(
    setMemberRoleAction,
    {},
  );

  return (
    <details>
      <summary className="stamp inline-block cursor-pointer list-none rounded-chip border-[3px] border-ink bg-porcelain px-[15px] py-[8px] text-[14px] font-bold text-ink hover:bg-cream-2">
        Access level
      </summary>
      <form action={formAction} className="mt-[8.8px] flex flex-wrap items-center gap-[8.8px]">
        <input type="hidden" name="userId" value={userId} />
        <select
          name="role"
          defaultValue={role}
          disabled={self}
          aria-label="Access level"
          className="h-[38px] rounded-chip border-[3px] border-ink bg-porcelain px-[11px] font-mono text-[13px] text-ink disabled:opacity-50"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <Submit />
        {state.error && <Notice tone="warn">{state.error}</Notice>}
      </form>
    </details>
  );
}
