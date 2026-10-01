"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { PASSWORD_MAX, USERNAME_MAX, USERNAME_MIN } from "@/lib/auth-rules";
import { Button, Input, Label, Notice } from "@/components/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Setting up…" : "Create the first admin"}
    </Button>
  );
}

type SetupAction = (
  prev: { error?: string; field?: "name" | "email" | "username" | "password" },
  formData: FormData,
) => Promise<{ error?: string; field?: "name" | "email" | "username" | "password" }>;

export function SetupForm({
  passwordMin,
  usernameRule,
  action,
}: {
  passwordMin: number;
  usernameRule: string;
  action: SetupAction;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-[17.6px]">
      <div>
        <Label htmlFor="setup-name">Your name</Label>
        <Input
          id="setup-name"
          name="name"
          required
          maxLength={80}
          placeholder="Ruben Haas"
          autoComplete="name"
          aria-invalid={state.field === "name" || undefined}
        />
      </div>

      <div>
        <Label htmlFor="setup-email">Email</Label>
        <Input
          id="setup-email"
          name="email"
          type="email"
          required
          placeholder="you@example.org"
          autoComplete="email"
          aria-invalid={state.field === "email" || undefined}
        />
      </div>

      <div>
        <Label htmlFor="setup-username">Pick a username</Label>
        <Input
          id="setup-username"
          name="username"
          required
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          pattern="[A-Za-z0-9_\-]+"
          placeholder="ruben"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="setup-username-hint"
          aria-invalid={state.field === "username" || undefined}
        />
        <p
          id="setup-username-hint"
          className={`mt-[6px] text-[12.5px] leading-[1.4] ${
            state.field === "username"
              ? "font-bold text-cherry-dk"
              : "font-mono uppercase tracking-[0.04em] text-ink-3"
          }`}
        >
          {usernameRule}
        </p>
      </div>

      <div>
        <Label htmlFor="setup-password">Password</Label>
        <Input
          id="setup-password"
          name="password"
          type="password"
          required
          minLength={passwordMin}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
          aria-describedby="setup-password-hint"
          aria-invalid={state.field === "password" || undefined}
        />
        <p
          id="setup-password-hint"
          className={`mt-[6px] text-[12.5px] leading-[1.4] ${
            state.field === "password"
              ? "font-bold text-cherry-dk"
              : "font-mono uppercase tracking-[0.04em] text-ink-3"
          }`}
        >
          At least {passwordMin} characters. Checked against known breaches.
        </p>
      </div>

      {state.error && <Notice tone="warn">{state.error}</Notice>}

      <Submit />
    </form>
  );
}
