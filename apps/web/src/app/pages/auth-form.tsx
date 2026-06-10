"use client";

import { setupAuthClient } from "@/lib/auth-client";
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Alert } from "@vc/ui";
import { ReloadIcon } from "@radix-ui/react-icons";
import { useState } from "react";

export function AuthForm({ authUrl }: { authUrl: string }) {
  const authClient = setupAuthClient(authUrl);
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function ensureOnboarding() {
    return fetch("/api/onboarding/ensure", { method: "POST" });
  }

  function submit() {
    setError(null);
    setLoading(true);
    const callbacks = {
      onSuccess: async () => {
        await ensureOnboarding();
        window.location.href = "/app";
      },
      onError: (ctx: { error: { message?: string } }) => {
        setError(ctx.error.message ?? "Authentication failed");
        setLoading(false);
      },
    };
    if (isSignUp) {
      void authClient.signUp.email({ name, email, password }, callbacks);
    } else {
      void authClient.signIn.email({ email, password }, callbacks);
    }
  }

  return (
    <form className="mt-8" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {error ? (
        <Alert variant="error" className="mb-4">{error}</Alert>
      ) : null}
      <FieldGroup className="gap-4">
      {isSignUp ? (
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            className="h-11 rounded-lg bg-background"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          className="h-11 rounded-lg bg-background"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          spellCheck={false}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          className="h-11 rounded-lg bg-background"
          type="password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
        />
      </Field>
      <Field>
        <Button
          className="h-11 w-full rounded-lg"
          type="submit"
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? (
            <>
              <ReloadIcon className="size-4 animate-spin" aria-hidden="true" />
              {isSignUp ? "Creating account\u2026" : "Signing in\u2026"}
            </>
          ) : (
            isSignUp ? "Create account" : "Sign in"
          )}
        </Button>
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
