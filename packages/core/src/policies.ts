export { hasActiveSubscription } from "@vc/config";
import { ForbiddenError } from "./errors";
import type { Actor, Scope } from "./types";


export function can(actor: Actor, scope: Scope): boolean {
  if (actor.type === "system") return true;
  if (actor.type === "human") {
    if (actor.role === "owner") return true;
    if (actor.role === "editor") {
      return [
        "sites:read",
        "posts:read",
        "posts:create",
        "posts:update",
        "posts:publish",
        "posts:archive",
        "assets:write",
        "assets:delete",
        "activity:read",
      ].includes(scope);
    }
    return ["sites:read", "posts:read", "activity:read"].includes(scope);
  }
  return actor.scopes.includes(scope);
}

export function requireScope(actor: Actor, scope: Scope): void {
  if (!can(actor, scope)) throw new ForbiddenError(`Missing required scope: ${scope}. This key cannot perform the action. Explain the missing capability to the owner; do not retry or widen access automatically.`);
}
