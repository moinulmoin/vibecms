/** App-host login URL for marketing CTAs (apex public worker has no /login). */
export function appLoginUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/login`;
}

/** "Start free" CTAs: the same sign-in, worded for someone creating a blog. */
export function startFreeUrl(loginUrl: string): string {
  return `${loginUrl}?intent=start`;
}

export function appApiDocsUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/v1/docs`;
}