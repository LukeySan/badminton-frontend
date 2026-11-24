import type { RallyPublic, ReelEdit } from "@/client"
import {
  clampToReel,
  cleanPatch,
  cutOverlay,
  fitOverlaySpan,
  MAX_OVERLAYS,
  OVERLAY_SIZE,
  type Overlay,
  type OverlayPatch,
} from "./overlays"
import type { RallyFix } from "./rallyFixes"

// A reel is a non-destructive edit list over one match video (the backend's ReelEdit,
// version 6): a flat list of clips, played one after another in list order. Each clip
// is a stretch of the original video (seconds, stored to 0.1 s, at least 0.3 s long).
// Clips may overlap in source time (a replay) and can be in any order. `rally_id` is
// only a label (which rally the footage shows; null for footage outside rallies): it
// never changes what plays. Overlays (text) are on the reel's own timeline (reel
// seconds), so they stay where they are in the reel when clips change under them
// (overlays.ts).

export type Span = { start: number; end: number }
/** One clip of the reel (the API's Segment; the app calls them clips). */
export type Clip = {
  id: string
  start: number
  end: number
  slow_mo: boolean
  rally_id: number | null
}
/** Every optional field filled in, so the editor never has to check. */
export type Edit = {
  version: 6
  format: "16:9" | "9:16"
  segments: Clip[]
  overlays: Overlay[]
}

export type ReelFormat = Edit["format"]

/** Shortest clip (the backend's MIN_SEGMENT_SECONDS). */
export const MIN_CLIP = 0.3
/** A rally picked into the reel gets this much footage before and after it (seconds):
 *  detected boundaries can be 1-2 s off. */
export const CLIP_PADDING = 1
/** Most clips in a reel (the backend's MAX_REEL_SEGMENTS). */
export const MAX_CLIPS = 200
/** How many rallies the "Longest 5" quick start picks. */
export const QUICK_PICKS = 5

export function normalizeEdit(edit: ReelEdit | undefined): Edit {
  return {
    version: 6,
    format: edit?.format ?? "16:9",
    segments: (edit?.segments ?? []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      slow_mo: s.slow_mo ?? false,
      rally_id: s.rally_id ?? null,
    })),
    overlays: (edit?.overlays ?? []).map((o) => ({
      ...o,
      size: o.size ?? OVERLAY_SIZE.default,
    })),
  }
}

// --- Times ---------------------------------------------------------------------------

/** Seconds to the 0.1 s the backend stores (so what we keep is what it keeps). */
export const round1 = (t: number) => Math.round(t * 10) / 10
/** The last 0.1 s step inside the video (no limit while the duration is unknown). */
const lastStep = (duration: number) =>
  duration > 0
    ? Math.floor(duration * 10 + 1e-6) / 10
    : Number.POSITIVE_INFINITY

/**
 * A clip's bounds made valid: on the 0.1 s grid, inside the video, at least MIN_CLIP
 * long (`keep` says which edge stays put when it's too short).
 */
export function fitBounds(
  span: Span,
  duration: number,
  keep: "start" | "end" = "start",
): Span {
  const limit = lastStep(duration)
  let start = Math.min(Math.max(0, round1(span.start)), limit)
  let end = Math.min(Math.max(0, round1(span.end)), limit)
  if (end - start < MIN_CLIP - 1e-9) {
    if (keep === "start") end = Math.min(limit, round1(start + MIN_CLIP))
    else start = Math.max(0, round1(end - MIN_CLIP))
    // Against the video's start or end: the other edge gives
    if (end - start < MIN_CLIP - 1e-9) {
      if (keep === "start") start = Math.max(0, round1(end - MIN_CLIP))
      else end = Math.min(limit, round1(start + MIN_CLIP))
    }
  }
  return { start, end }
}

/** How long a clip plays in the reel: slow-mo plays at half speed. */
export const clipLength = (clip: Pick<Clip, "start" | "end" | "slow_mo">) =>
  (clip.end - clip.start) * (clip.slow_mo ? 2 : 1)

export const reelLength = (edit: Pick<Edit, "segments">) =>
  edit.segments.reduce((sum, clip) => sum + clipLength(clip), 0)

/** A new clip for a rally: its detected bounds plus CLIP_PADDING each side. */
export const paddedRally = (rally: Span, duration: number): Span =>
  fitBounds(
    { start: rally.start - CLIP_PADDING, end: rally.end + CLIP_PADDING },
    duration,
  )

const overlap = (a: Span, b: Span) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start)

// --- Ids -------------------------------------------------------------------------------

/**
 * Ids for new clips, unique in the reel ("c8", "c9"...). Pure, so the reducer can
 * make them and the screen can know them in advance (to select the new clip).
 */
export function newClipIds(edit: Edit, count = 1): string[] {
  const used = new Set(edit.segments.map((clip) => clip.id))
  const ids: string[] = []
  let n = edit.segments.length + 1
  while (ids.length < count) {
    const id = `c${n++}`
    if (!used.has(id)) ids.push(id)
  }
  return ids
}
export const newClipId = (edit: Edit) => newClipIds(edit)[0]

// --- Picking rallies (Highlights' check circles, quick starts) -------------------------

export const isRallyPicked = (edit: Edit, rallyId: number) =>
  edit.segments.some((clip) => clip.rally_id === rallyId)

/**
 * Where a clip starting at `start` goes "in match order": before the first clip (in
 * list order) that starts after it. In a reel that was never reordered that's its
 * place in time; in a reordered one, it lands next to its neighbours in time.
 */
export const matchOrderIndex = (edit: Edit, start: number) => {
  const i = edit.segments.findIndex((clip) => clip.start > start)
  return i < 0 ? edit.segments.length : i
}

/** Add a rally to the reel (its padded bounds), in match order. */
export function pickRally(
  edit: Edit,
  rally: Span & { id: number },
  duration: number,
  id = newClipId(edit),
): Edit {
  if (isRallyPicked(edit, rally.id) || edit.segments.length >= MAX_CLIPS)
    return edit
  const span = paddedRally(rally, duration)
  const clip: Clip = { id, ...span, slow_mo: false, rally_id: rally.id }
  return insertClip(edit, clip, matchOrderIndex(edit, span.start))
}

/** Add several rallies at once (quick starts), each in match order. */
export function pickMany(
  edit: Edit,
  rallies: (Span & { id: number })[],
  duration: number,
): Edit {
  return rallies.reduce((next, rally) => pickRally(next, rally, duration), edit)
}

/** Take a rally out of the reel: every clip labelled with it. */
export const unpickRally = (edit: Edit, rallyId: number): Edit => ({
  ...edit,
  segments: edit.segments.filter((clip) => clip.rally_id !== rallyId),
})

// --- Editing clips -------------------------------------------------------------------

const mapClip = (edit: Edit, id: string, change: (clip: Clip) => Clip) => ({
  ...edit,
  segments: edit.segments.map((clip) => (clip.id === id ? change(clip) : clip)),
})

/** Can the clip be cut at `at`? Both parts must be at least MIN_CLIP long. */
export function canCut(clip: Clip | undefined, at: number) {
  if (!clip) return false
  const t = round1(at)
  return t - clip.start >= MIN_CLIP - 1e-9 && clip.end - t >= MIN_CLIP - 1e-9
}

/** Split a clip in two at `at` (both keep its speed and label; the second is `newId`). */
export function cutClip(
  edit: Edit,
  id: string,
  at: number,
  newId = newClipId(edit),
): Edit {
  const i = edit.segments.findIndex((clip) => clip.id === id)
  const clip = edit.segments[i]
  if (!canCut(clip, at) || edit.segments.length >= MAX_CLIPS) return edit
  const t = round1(at)
  const segments = [...edit.segments]
  segments.splice(i, 1, { ...clip, end: t }, { ...clip, id: newId, start: t })
  return { ...edit, segments }
}

export const deleteClip = (edit: Edit, id: string): Edit => ({
  ...edit,
  segments: edit.segments.filter((clip) => clip.id !== id),
})

export const toggleSlowMo = (edit: Edit, id: string): Edit =>
  mapClip(edit, id, (clip) => ({ ...clip, slow_mo: !clip.slow_mo }))

/** New start / end for a clip (a finished edge drag): anywhere in the video. */
export function setClipBounds(
  edit: Edit,
  id: string,
  span: Span,
  duration: number,
): Edit {
  const old = edit.segments.find((clip) => clip.id === id)
  if (!old) return edit
  // The edge that moved is the one that gives when the clip gets too short
  const keep = span.start !== old.start ? "end" : "start"
  return mapClip(edit, id, (clip) => ({
    ...clip,
    ...fitBounds(span, duration, keep),
  }))
}

/** Move a clip to position `to` (its index in the list afterwards). */
export function moveClip(edit: Edit, id: string, to: number): Edit {
  const from = edit.segments.findIndex((clip) => clip.id === id)
  if (from < 0) return edit
  const segments = [...edit.segments]
  const [clip] = segments.splice(from, 1)
  segments.splice(Math.min(Math.max(0, to), segments.length), 0, clip)
  return { ...edit, segments }
}

/** Put a clip into the list at `index` (Add footage, picks). */
export function insertClip(edit: Edit, clip: Clip, index: number): Edit {
  if (edit.segments.length >= MAX_CLIPS) return edit
  const segments = [...edit.segments]
  segments.splice(Math.min(Math.max(0, index), segments.length), 0, clip)
  return { ...edit, segments }
}

/** The rally a stretch of footage shows most of (for a new clip's label), if any. */
export function rallyOver(
  span: Span,
  rallies: (Span & { id: number })[],
): number | null {
  let best: { id: number; amount: number } | undefined
  for (const rally of rallies) {
    const amount = overlap(span, rally)
    if (amount > 0 && (!best || amount > best.amount))
      best = { id: rally.id, amount }
  }
  return best?.id ?? null
}

// --- Overlays ----------------------------------------------------------------------------

const mapOverlay = (
  edit: Edit,
  id: string,
  change: (overlay: Overlay) => Overlay,
): Edit => ({
  ...edit,
  overlays: edit.overlays.map((o) => (o.id === id ? change(o) : o)),
})

/** Add an overlay (on top of the others), up to MAX_OVERLAYS. */
export const addOverlay = (edit: Edit, overlay: Overlay): Edit =>
  edit.overlays.length >= MAX_OVERLAYS ||
  edit.overlays.some((o) => o.id === overlay.id)
    ? edit
    : { ...edit, overlays: [...edit.overlays, overlay] }

/** Change how an overlay looks: position, size, text (a finished move, resize or edit). */
export const updateOverlay = (
  edit: Edit,
  id: string,
  patch: OverlayPatch,
): Edit => mapOverlay(edit, id, (o) => ({ ...o, ...cleanPatch(patch) }))

/** New start / end in reel time (a finished edge drag or move on the timeline). */
export function setOverlayTimes(edit: Edit, id: string, span: Span): Edit {
  const old = edit.overlays.find((o) => o.id === id)
  if (!old) return edit
  const keep =
    span.start !== old.start && span.end === old.end ? "end" : "start"
  return mapOverlay(edit, id, (o) => ({
    ...o,
    ...fitOverlaySpan(span, reelLength(edit), keep),
  }))
}

export const deleteOverlay = (edit: Edit, id: string): Edit => ({
  ...edit,
  overlays: edit.overlays.filter((o) => o.id !== id),
})

// --- Quick starts -------------------------------------------------------------------------

/** The `count` longest rallies, in match order. */
export const longestRallies = (rallies: RallyPublic[], count = QUICK_PICKS) =>
  [...rallies]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, count)
    .sort((a, b) => a.start - b.start)

// --- Rally labels ---------------------------------------------------------------------

/** Point labels at new rally ids (after a rally fix is undone or redone). */
export function remapRallies(edit: Edit, ids: Map<number, number>): Edit {
  if (ids.size === 0) return edit
  return {
    ...edit,
    segments: edit.segments.map((clip) =>
      clip.rally_id === null
        ? clip
        : { ...clip, rally_id: ids.get(clip.rally_id) ?? clip.rally_id },
    ),
  }
}

/**
 * After a rally fix: a clip labelled with a rally that's gone (deleted, merged) gets
 * the rally it now shows most of, or none. What plays never changes.
 */
export function relabel(edit: Edit, rallies: RallyPublic[]): Edit {
  const known = new Set(rallies.map((r) => r.id))
  return {
    ...edit,
    segments: edit.segments.map((clip) =>
      clip.rally_id === null || known.has(clip.rally_id)
        ? clip
        : { ...clip, rally_id: rallyOver(clip, rallies) },
    ),
  }
}

// --- Edit history: one reducer, undo / redo ---------------------------------------------
//
// Every state the user can go back to, oldest first. An entry reached through a rally
// fix (a server change to the match's rallies) carries that fix: undoing it calls the
// reverse endpoint first, redoing it the forward one. Those calls give rallies new ids,
// so the entries on that side of the fix (up to the next fix) get their labels remapped.

export type HistoryEntry = { edit: Edit; fix?: RallyFix }
export type EditHistory = { entries: HistoryEntry[]; index: number }

export const presentEdit = (history: EditHistory) =>
  history.entries[history.index].edit
export const canUndo = (history: EditHistory) => history.index > 0
export const canRedo = (history: EditHistory) =>
  history.index < history.entries.length - 1
/** The fix that undo would reverse (the present entry was reached through it). */
export const fixToUndo = (history: EditHistory) =>
  history.entries[history.index].fix
/** The fix that redo would apply again. */
export const fixToRedo = (history: EditHistory) =>
  history.entries[history.index + 1]?.fix

export type EditAction =
  /** The server's version (first load, or after a conflict): no undo past it. */
  | { type: "load"; edit: Edit }
  | { type: "set-format"; format: ReelFormat }
  | { type: "pick-rally"; rally: Span & { id: number }; duration: number }
  /** Quick starts (Longest 5, All rallies): one undo step. */
  | { type: "pick-many"; rallies: (Span & { id: number })[]; duration: number }
  | { type: "unpick-rally"; rallyId: number }
  | { type: "cut"; id: string; at: number; newId: string }
  | { type: "delete"; id: string }
  | { type: "toggle-slow-mo"; id: string }
  /** A finished edge drag (one undo step per drag). */
  | { type: "set-bounds"; id: string; span: Span; duration: number }
  /** A finished reorder drag. */
  | { type: "move"; id: string; to: number }
  | { type: "insert"; clip: Clip; index: number }
  | { type: "add-overlay"; overlay: Overlay }
  /** A finished move, resize or text edit of an overlay (one undo step). */
  | { type: "update-overlay"; id: string; patch: OverlayPatch }
  /** A finished edge drag or move of an overlay on the timeline. */
  | { type: "set-overlay-times"; id: string; span: Span }
  | { type: "cut-overlay"; id: string; at: number; newId: string }
  | { type: "delete-overlay"; id: string }
  /** A rally fix went through: the reel as it is after it (one undo step). */
  | { type: "fix"; fix: RallyFix; edit: Edit }
  | { type: "undo" }
  | { type: "redo" }
  /** The reverse endpoint ran: `ids` are the rallies on the before side now. */
  | { type: "undo-fix"; ids: number[] }
  /** The forward endpoint ran again: `ids` are the rallies on the after side now. */
  | { type: "redo-fix"; ids: number[] }

/** Steps kept for undo. */
const MAX_HISTORY = 100

export function initialHistory(edit: Edit): EditHistory {
  return { entries: [{ edit }], index: 0 }
}

function push(history: EditHistory, entry: HistoryEntry): EditHistory {
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(
    -MAX_HISTORY,
  )
  return { entries, index: entries.length - 1 }
}

/**
 * A change: the old state stays on the undo stack, redo is cleared. Overlays are kept
 * inside the reel as the backend keeps them (so what's here is what it saves).
 */
function commit(history: EditHistory, changed: Edit): EditHistory {
  const overlays = clampToReel(changed.overlays, reelLength(changed))
  const next =
    overlays === changed.overlays ? changed : { ...changed, overlays }
  if (JSON.stringify(next) === JSON.stringify(presentEdit(history)))
    return history
  return push(history, { edit: next })
}

const idMap = (from: number[], to: number[]) =>
  new Map(from.flatMap((id, i) => (to[i] !== undefined ? [[id, to[i]]] : [])))
const remapIds = (ids: number[], map: Map<number, number>) =>
  ids.map((id) => map.get(id) ?? id)

export function editReducer(
  history: EditHistory,
  action: EditAction,
): EditHistory {
  const edit = presentEdit(history)
  switch (action.type) {
    case "load":
      return initialHistory(action.edit)
    case "undo":
      // A fix can't be undone here: the editor calls the endpoint, then "undo-fix".
      if (!canUndo(history) || fixToUndo(history)) return history
      return { ...history, index: history.index - 1 }
    case "redo":
      if (!canRedo(history) || fixToRedo(history)) return history
      return { ...history, index: history.index + 1 }
    case "undo-fix": {
      const fix = fixToUndo(history)
      if (!fix) return history
      const map = idMap(fix.before, action.ids)
      const entries = [...history.entries]
      entries[history.index] = {
        ...entries[history.index],
        fix: { ...fix, before: action.ids } as RallyFix,
      }
      // The before side: back to (and including) the entry that starts it
      for (let i = history.index - 1; i >= 0; i--) {
        const entry = entries[i]
        entries[i] = {
          edit: remapRallies(entry.edit, map),
          fix:
            entry.fix &&
            ({
              ...entry.fix,
              after: remapIds(entry.fix.after, map),
            } as RallyFix),
        }
        if (entry.fix) break
      }
      return { entries, index: history.index - 1 }
    }
    case "redo-fix": {
      const target = history.index + 1
      const fix = fixToRedo(history)
      if (!fix) return history
      const map = idMap(fix.after, action.ids)
      const entries = [...history.entries]
      entries[target] = {
        edit: remapRallies(entries[target].edit, map),
        fix: { ...fix, after: action.ids } as RallyFix,
      }
      // The after side: up to the next fix, whose "before" ids are these rallies too
      for (let i = target + 1; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.fix) {
          entries[i] = {
            ...entry,
            fix: {
              ...entry.fix,
              before: remapIds(entry.fix.before, map),
            } as RallyFix,
          }
          break
        }
        entries[i] = { edit: remapRallies(entry.edit, map) }
      }
      return { entries, index: target }
    }
    case "fix":
      return push(history, { edit: action.edit, fix: action.fix })
    case "set-format":
      return commit(history, { ...edit, format: action.format })
    case "pick-rally":
      return commit(history, pickRally(edit, action.rally, action.duration))
    case "pick-many":
      return commit(history, pickMany(edit, action.rallies, action.duration))
    case "unpick-rally":
      return commit(history, unpickRally(edit, action.rallyId))
    case "cut":
      return commit(history, cutClip(edit, action.id, action.at, action.newId))
    case "delete":
      return commit(history, deleteClip(edit, action.id))
    case "toggle-slow-mo":
      return commit(history, toggleSlowMo(edit, action.id))
    case "set-bounds":
      return commit(
        history,
        setClipBounds(edit, action.id, action.span, action.duration),
      )
    case "move":
      return commit(history, moveClip(edit, action.id, action.to))
    case "insert":
      return commit(history, insertClip(edit, action.clip, action.index))
    case "add-overlay":
      return commit(history, addOverlay(edit, action.overlay))
    case "update-overlay":
      return commit(history, updateOverlay(edit, action.id, action.patch))
    case "set-overlay-times":
      return commit(history, setOverlayTimes(edit, action.id, action.span))
    case "cut-overlay":
      return commit(history, {
        ...edit,
        overlays: cutOverlay(edit.overlays, action.id, action.at, action.newId),
      })
    case "delete-overlay":
      return commit(history, deleteOverlay(edit, action.id))
  }
}
