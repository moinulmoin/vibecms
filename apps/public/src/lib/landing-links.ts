/** App-host login URL for marketing CTAs (apex public worker has no /login). */
export function appLoginUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/login`;
}

export function appApiDocsUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/v1/docs`;
}