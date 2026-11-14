// Rally navigation, kept free of React so the rules are easy to read and test.
// All times are seconds on the video's timeline (same as the API).

import type { RallyPublic } from "@/client"

/** Played before and after each rally: detected boundaries can be 1-2 s off. */
export const RALLY_PADDING = 1

/** Within this distance of a rally's padded start counts as inside it. A seek can
 *  land a hair before the requested time; without this, skip-breaks would loop. */
const EPSILON = 0.05

/** Pressing "previous" this far into a rally restarts it instead (like a music app). */
const RESTART_AFTER = 3

export type Segment = {
  /** 1-based, in time order over *all* rallies, so it stays the same when the list
   *  is filtered or sorted ("rally 12" always means the same rally). */
  number: number
  /** As detected. Drawn on the scrubber and shown in the list. */
  rally: RallyPublic
  /** What gets played: the rally plus padding, kept inside the video. */
  start: number
  end: number
}

export function toSegments(
  rallies: RallyPublic[],
  duration: number,
): Segment[] {
  return [...rallies]
    .sort((a, b) => a.start - b.start)
    .map((rally, index) => ({
      number: index + 1,
      rally,
      start: Math.max(0, rally.start - RALLY_PADDING),
      end:
        duration > 0
          ? Math.min(duration, rally.end + RALLY_PADDING)
          : rally.end + RALLY_PADDING,
    }))
}

/**
 * The segment playing at `t`. Padded windows of close rallies can overlap (rallies
 * can be < 2 s apart), so the detected rally wins over a neighbour's padding.
 */
export function segmentAt(segments: Segment[], t: number): Segment | undefined {
  return (
    segments.find((s) => t >= s.rally.start && t < s.rally.end) ??
    segments.find((s) => t >= s.start - EPSILON && t < s.end)
  )
}

export function nextSegment(
  segments: Segment[],
  t: number,
): Segment | undefined {
  const current = segmentAt(segments, t)
  if (current) return segments[segments.indexOf(current) + 1]
  return segments.find((s) => s.start > t)
}

export function previousSegment(
  segments: Segment[],
  t: number,
): Segment | undefined {
  const current = segmentAt(segments, t)
  if (current) {
    if (t - current.start > RESTART_AFTER) return current
    return segments[segments.indexOf(current) - 1] ?? current
  }
  return [...segments].reverse().find((s) => s.end <= t)
}

/**
 * Skip-breaks: where to go from `t`.
 * `undefined` = keep playing (inside a rally), a number = seek there,
 * `null` = no rallies left (stop).
 */
export function skipTarget(
  spans: { start: number; end: number }[],
  t: number,
): number | null | undefined {
  if (spans.some((s) => t >= s.start - EPSILON && t < s.end)) return undefined
  const next = spans.find((s) => s.start > t)
  return next ? next.start : null
}

/** Total time of actual play (detected rallies, no padding). */
export function rallyTime(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + s.rally.duration, 0)
}
