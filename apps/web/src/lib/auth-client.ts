import { createAuthClient } from "better-auth/react";

export function setupAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    basePath: "/api/auth",
  });
}
