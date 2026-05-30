"use client";

import { setupAuthClient } from "@/lib/auth-client";
import { Button, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, Input } from "@vc/ui";
import { useState, useTransition } from "react";

export function AuthForm({ authUrl }: { authUrl: string }) {
  const authClient = setupAuthClient(authUrl);
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function ensureOnboarding() {
    return fetch("/api/onboarding/ensure", { method: "POST" });
  }

  function submit() {
    setError(null);
    startTransition(() => {
      const callbacks = {
        onSuccess: async () => {
          await ensureOnboarding();
          window.location.href = "/app";
        },
        onError: (ctx: { error: { message?: string } }) => setError(ctx.error.message ?? "Authentication failed"),
      };
      if (isSignUp) {
        void authClient.signUp.email({ name, email, password }, callbacks);
      } else {
        void authClient.signIn.email({ email, password }, callbacks);
      }
    });
  }

  return (
    <form className="mt-8" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <FieldGroup className="gap-4">
      {isSignUp ? (
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" className="h-11 rounded-xl bg-background" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" className="h-11 rounded-xl bg-background" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input id="password" className="h-11 rounded-xl bg-background" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
      </Field>
      <FieldError className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 font-bold">{error}</FieldError>
      <Field>
        <Button className="h-11 rounded-xl" type="submit" disabled={isPending}>{isPending ? "Working…" : isSignUp ? "Create account" : "Sign in"}</Button>
      </Field>
      <Field className="gap-1 text-left sm:flex-row sm:items-center">
        <FieldDescription>{isSignUp ? "Already have an account?" : "New to VibeCMS?"}</FieldDescription>
        <Button className="h-auto justify-start px-0 font-semibold underline" type="button" variant="link" onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? "Sign in instead" : "Create an account"}
        </Button>
      </Field>
      </FieldGroup>
    </form>
  );
}
