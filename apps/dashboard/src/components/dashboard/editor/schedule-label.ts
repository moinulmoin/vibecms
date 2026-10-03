export function scheduledLabel(publishAt: number): string {
  return `Scheduled · ${new Intl.DateTimeFormat(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(publishAt * 1000))}`
}
