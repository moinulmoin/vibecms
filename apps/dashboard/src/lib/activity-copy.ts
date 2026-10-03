/** One voice for activity rows, wherever they appear (Activity page, Overview). */

const SUMMARY_OVERRIDES: Record<string, string> = {
  'api_key.revoked': 'Deleted an agent key',
}

/** Stored summaries predate the "agent key" wording; normalize at display. */
export function activitySummary(action: string, summary: string): string {
  const override = SUMMARY_OVERRIDES[action]
  if (override) return override
  const created = /^Created API key (.+)$/.exec(summary)
  if (created) return `Created agent key “${created[1]}”`
  return summary
}

/** vibecms itself (setup, background jobs) reads as "vibecms", never "System". */
export function isSystemActor(actorType: string | null | undefined, actorName: string | null | undefined): boolean {
  return actorType === 'system' || actorName?.trim().toLowerCase() === 'system'
}
