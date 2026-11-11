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

/** Shorter than this (seconds) counts as nothing: no gap, no break. */
export const MIN_SPAN = 0.05

/**
 * The footage around the clips: before the first, between each pair, after the last
 * (all of it when there are no clips). In "Rallies only" a region is cut unless it
 * was restored; in "Full video" every region stays.
 */
export type Region = { start: number; end: number; restored: boolean }

export function regionsOf(edit: Edit, duration: number): Region[] {
  const bounds: [number, number][] = []
  let cursor = 0
  for (const clip of edit.clips) {
    bounds.push([cursor, clip.trim_start])
    cursor = Math.max(cursor, clip.trim_end)
  }
  bounds.push([cursor, Math.max(cursor, duration)])
  return bounds
    .filter(([start, end]) => end - start >= MIN_SPAN)
    .map(([start, end]) => ({
      start,
      end,
      restored: edit.restored_gaps.some(
        (gap) =>
          Math.min(gap.end, end) - Math.max(gap.start, start) >= MIN_SPAN,
      ),
    }))
}

/** A region plays in the reel: always in "Full video", if restored in "Rallies only". */
export const regionShown = (edit: Edit, region: Region) =>
  edit.view === "full" || region.restored

/** The reel's length: clips (slow-mo counts double) plus the footage kept around them. */
export function reelLength(edit: Edit, duration: number): number {
  const clips = edit.clips.reduce((sum, clip) => sum + clipLength(clip), 0)
  const around = regionsOf(edit, duration)
    .filter((region) => regionShown(edit, region))
    .reduce((sum, region) => sum + (region.end - region.start), 0)
  return clips + around
}

/**
 * A clip of a rally with the player's padding (detector times can be 1-2 s off),
 * but never over its neighbors in the reel or past the video's ends.
 */
export function clipFromRally(
  rally: RallyPublic,
  duration: number,
  clips: ReelClip[] = [],
): ReelClip {
  const before = clips.filter((c) => c.trim_start <= rally.start)
  const after = clips.filter((c) => c.trim_start > rally.start)
  const floor = Math.max(0, ...before.map((c) => c.trim_end))
  const ceiling = Math.min(
    duration > 0 ? duration : Number.POSITIVE_INFINITY,
    ...after.map((c) => c.trim_start),
  )
  const start = Math.max(floor, rally.start - RALLY_PADDING)
  const end = Math.min(ceiling, rally.end + RALLY_PADDING)
  return {
    rally_id: rally.id,
    // A rally already covered by a neighbor's padding still gets its own times.
    trim_start: round3(end > start ? start : rally.start),
    trim_end: round3(end > start ? end : rally.end),
    slow_mo: false,
  }
}

const round3 = (t: number) => Math.round(t * 1000) / 1000

/** The clip made from this rally, if it's in the reel. */
export const clipOfRally = (edit: Edit, rallyId: number) =>
  edit.clips.find((clip) => clip.rally_id === rallyId)

/** Add a rally to the reel, in match order. */
export function pickRally(
  edit: Edit,
  rally: RallyPublic,
  duration: number,
): Edit {
  if (clipOfRally(edit, rally.id)) return edit
  const clip = clipFromRally(rally, duration, edit.clips)
  const clips = [...edit.clips, clip].sort(
    (a, b) => a.trim_start - b.trim_start,
  )
  return { ...edit, clips }
}

/** Show a hidden stretch again in "Rallies only" (stored as its time range). */
export function restoreRegion(
  edit: Edit,
  region: { start: number; end: number },
): Edit {
  return {
    ...edit,
    restored_gaps: [
      ...hideRegion(edit, region).restored_gaps,
      { start: round3(region.start), end: round3(region.end) },
    ],
  }
}

/** Hide a stretch again: drop every restored range that overlaps it. */
export function hideRegion(
  edit: Edit,
  region: { start: number; end: number },
): Edit {
  return {
    ...edit,
    restored_gaps: edit.restored_gaps.filter(
      (gap) =>
        Math.min(gap.end, region.end) - Math.max(gap.start, region.start) <
        MIN_SPAN,
    ),
  }
}

// --- Trimming and the tools ---------------------------------------------------------

/** Trim handles snap to this (seconds). */
export const TRIM_SNAP = 0.1
/** A clip can't be trimmed shorter than this. */
export const MIN_CLIP = 0.5
/** Longest caption (the backend's CAPTION_MAX_LENGTH). */
export const CAPTION_MAX = 80

/**
 * Where a clip's edges may go: snapped to 0.1 s, never over the neighboring clips or
 * past the video's ends, and at least MIN_CLIP long. `edge` says which end moved, so
 * the other one stays put.
 */
export function constrainTrim(
  edit: Edit,
  clipIndex: number,
  edge: "start" | "end",
  value: number,
  duration: number,
): { trim_start: number; trim_end: number } {
  const clip = edit.clips[clipIndex]
  const previous = edit.clips[clipIndex - 1]
  const next = edit.clips[clipIndex + 1]
  const floor = previous ? previous.trim_end : 0
  const ceiling = next
    ? next.trim_start
    : duration > 0
      ? duration
      : Number.POSITIVE_INFINITY
  const snap = (t: number) => round3(Math.round(t / TRIM_SNAP) * TRIM_SNAP)
  if (edge === "start") {
    const start = Math.min(
      Math.max(snap(value), floor),
      clip.trim_end - MIN_CLIP,
    )
    return {
      trim_start: round3(Math.max(start, floor)),
      trim_end: clip.trim_end,
    }
  }
  const end = Math.max(
    Math.min(snap(value), ceiling),
    clip.trim_start + MIN_CLIP,
  )
  return {
    trim_start: clip.trim_start,
    trim_end: round3(Math.min(end, ceiling)),
  }
}

const replaceClip = (
  edit: Edit,
  clipIndex: number,
  clip: Partial<ReelClip>,
) => ({
  ...edit,
  clips: edit.clips.map((c, i) => (i === clipIndex ? { ...c, ...clip } : c)),
})

/** The caption shown over a clip (the first one overlapping it). */
export function captionOfClip(edit: Edit, clip: ReelClip) {
  return edit.overlays.captions.find(
    (c) =>
      Math.min(c.end, clip.trim_end) - Math.max(c.start, clip.trim_start) >=
      MIN_SPAN,
  )
}

/** Set (or with an empty text, remove) the caption over a clip's time range. */
export function setClipCaption(edit: Edit, clip: ReelClip, text: string): Edit {
  const others = edit.overlays.captions.filter(
    (c) =>
      Math.min(c.end, clip.trim_end) - Math.max(c.start, clip.trim_start) <
      MIN_SPAN,
  )
  const trimmed = text.trim().slice(0, CAPTION_MAX)
  return {
    ...edit,
    overlays: {
      ...edit.overlays,
      captions: trimmed
        ? [
            ...others,
            { start: clip.trim_start, end: clip.trim_end, text: trimmed },
          ]
        : others,
    },
  }
}

/** Take a rally out of the reel (its footage becomes part of the gap around it). */
export function unpickRally(edit: Edit, rallyId: number): Edit {
  return {
    ...edit,
    clips: edit.clips.filter((clip) => clip.rally_id !== rallyId),
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
    clips: withoutOverlaps(longest, duration),
  }
}

/** Clips for rallies (in match order), each padded but not over the previous one. */
function withoutOverlaps(rallies: RallyPublic[], duration: number) {
  const clips: ReelClip[] = []
  for (const rally of rallies) clips.push(clipFromRally(rally, duration, clips))
  return clips
}

// --- Edit history: one reducer, undo / redo ---------------------------------------

export type EditHistory = { past: Edit[]; present: Edit; future: Edit[] }

export type EditAction =
  /** The server's version (first load, or after a conflict): no undo past it. */
  | { type: "load"; edit: Edit }
  | { type: "set-format"; format: ReelFormat }
  | { type: "pick-rally"; rally: RallyPublic; duration: number }
  | { type: "unpick-rally"; rallyId: number }
  | { type: "set-view"; view: Edit["view"] }
  | { type: "restore-region"; region: { start: number; end: number } }
  | { type: "hide-region"; region: { start: number; end: number } }
  | {
      type: "trim-clip"
      clipIndex: number
      trim_start: number
      trim_end: number
    }
  | { type: "toggle-slow-mo"; clipIndex: number }
  | { type: "set-trail"; on: boolean }
  | { type: "set-caption"; clipIndex: number; text: string }
  | { type: "remove-clip"; clipIndex: number }
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
    case "pick-rally":
      return commit(
        history,
        pickRally(history.present, action.rally, action.duration),
      )
    case "unpick-rally":
      return commit(history, unpickRally(history.present, action.rallyId))
    case "set-view":
      return commit(history, { ...history.present, view: action.view })
    case "restore-region":
      return commit(history, restoreRegion(history.present, action.region))
    case "hide-region":
      return commit(history, hideRegion(history.present, action.region))
    case "trim-clip":
      return commit(
        history,
        replaceClip(history.present, action.clipIndex, {
          trim_start: action.trim_start,
          trim_end: action.trim_end,
        }),
      )
    case "toggle-slow-mo": {
      const clip = history.present.clips[action.clipIndex]
      if (!clip) return history
      return commit(
        history,
        replaceClip(history.present, action.clipIndex, {
          slow_mo: !clip.slow_mo,
        }),
      )
    }
    case "set-trail":
      return commit(history, {
        ...history.present,
        overlays: { ...history.present.overlays, trail: action.on },
      })
    case "set-caption": {
      const clip = history.present.clips[action.clipIndex]
      if (!clip) return history
      return commit(history, setClipCaption(history.present, clip, action.text))
    }
    case "remove-clip":
      return commit(history, {
        ...history.present,
        clips: history.present.clips.filter((_, i) => i !== action.clipIndex),
      })
  }
}
