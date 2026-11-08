// Display formatting. The API always sends times in seconds and dates as ISO strings;
// these turn them into text only at the edge, when rendering.

/** 425.03 → "7:05", 4884.5 → "1:21:25". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–"
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/** Rough "about N min" for estimates; never less than 1 minute. */
export function formatMinutes(seconds: number): string {
  return `about ${Math.max(1, Math.round(seconds / 60))} min`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

/**
 * The API sends microseconds ("…T07:13:41.290559Z"); keep milliseconds only, which
 * every JS engine parses (older Safari, i.e. the future iOS app, may not otherwise).
 */
export function parseApiDate(iso: string): Date {
  return new Date(iso.replace(/(\.\d{3})\d+/, "$1"))
}

/** In the user's locale and time zone. */
export function formatDate(iso: string): string {
  return dateFormat.format(parseApiDate(iso))
}
