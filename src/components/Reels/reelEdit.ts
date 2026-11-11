import type { RallyPublic, ReelClip, ReelEdit } from "@/client"
import { RALLY_PADDING } from "@/components/Player/rallies"

// A reel is a non-destructive edit list over one match video (the backend's
// ReelEdit): which stretches to keep, in which order, and how to show them.
// All times are seconds in the original video.

/** Every optional field filled in, so the editor never has to check. */
export type Edit = {
  version: 1
  view: "cut" | "full"
  format: "16:9" | "9:16"
  clips: ReelClip[]
  restored_gaps: { start: number; end: number }[]
  overlays: {
    trail: boolean
    captions: { start: number; end: number; text: string }[]
  }
}

export type ReelFormat = Edit["format"]

export function normalizeEdit(edit: ReelEdit | undefined): Edit {
  return {
    version: 1,
    view: edit?.view ?? "cut",
    format: edit?.format ?? "16:9",
    clips: (edit?.clips ?? []).map((clip) => ({
      ...clip,
      slow_mo: clip.slow_mo ?? false,
    })),
    restored_gaps: edit?.restored_gaps ?? [],
    overlays: {
      trail: edit?.overlays?.trail ?? false,
      captions: edit?.overlays?.captions ?? [],
    },
  }
}

/** How long a clip plays in the reel: slow-mo plays at half speed. */
export function clipLength(clip: ReelClip): number {
  return (clip.trim_end - clip.trim_start) * (clip.slow_mo ? 2 : 1)
}

/** The reel's length: its clips plus the breaks shown again between them. */
export function reelLength(edit: Edit): number {
  const clips = edit.clips.reduce((sum, clip) => sum + clipLength(clip), 0)
  const gaps = edit.restored_gaps.reduce((sum, g) => sum + (g.end - g.start), 0)
  return clips + gaps
}

/** A clip of a rally with the player's padding (detector times can be 1-2 s off). */
export function clipFromRally(rally: RallyPublic, duration: number): ReelClip {
  return {
    rally_id: rally.id,
    trim_start: Math.max(0, rally.start - RALLY_PADDING),
    trim_end:
      duration > 0
        ? Math.min(duration, rally.end + RALLY_PADDING)
        : rally.end + RALLY_PADDING,
    slow_mo: false,
  }
}

/** How many rallies "Make a highlight" picks to start with. */
export const STARTER_PICKS = 5

/** A new reel: the longest few rallies, in match order. */
export function starterEdit(rallies: RallyPublic[], duration: number): Edit {
  const longest = [...rallies]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, STARTER_PICKS)
    .sort((a, b) => a.start - b.start)
  return {
    ...normalizeEdit(undefined),
    clips: longest.map((rally) => clipFromRally(rally, duration)),
  }
}

// --- Edit history: one reducer, undo / redo ---------------------------------------

export type EditHistory = { past: Edit[]; present: Edit; future: Edit[] }

export type EditAction =
  /** The server's version (first load, or after a conflict): no undo past it. */
  | { type: "load"; edit: Edit }
  | { type: "set-format"; format: ReelFormat }
  | { type: "undo" }
  | { type: "redo" }

/** Steps kept for undo. */
const MAX_HISTORY = 100

export function initialHistory(edit: Edit): EditHistory {
  return { past: [], present: edit, future: [] }
}

/** A change: the old state goes on the undo stack, redo is cleared. */
function commit(history: EditHistory, next: Edit): EditHistory {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: next,
    future: [],
  }
}

export function editReducer(
  history: EditHistory,
  action: EditAction,
): EditHistory {
  switch (action.type) {
    case "load":
      return initialHistory(action.edit)
    case "undo": {
      const previous = history.past[history.past.length - 1]
      if (!previous) return history
      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    }
    case "redo": {
      const [next, ...rest] = history.future
      if (!next) return history
      return {
        past: [...history.past, history.present],
        present: next,
        future: rest,
      }
    }
    case "set-format":
      return commit(history, { ...history.present, format: action.format })
  }
}
