import type { RallyPublic, ReelEdit } from "@/client"
import type { RallyFix } from "./rallyFixes"

// A reel is a non-destructive edit list over one match video (the backend's
// ReelEdit, version 2): which rallies, cut into which pieces, in which order, and how
// to show them. All times are seconds in the original video.
//
// Each picked rally is a clip. A clip can use its rally's *window*: the rally plus
// lead_in before and lead_out after (detector times can be 1-2 s off), but never past
// the video's ends or into a neighbouring rally's window. Its pieces are the parts of
// the window that play; the rest of the window is "cut" (soft: it can be put back).

export type Span = { start: number; end: number }
export type Piece = Span & { slow_mo: boolean }
export type Clip = { rally_id: number; pieces: Piece[] }

/** Every optional field filled in, so the editor never has to check. */
export type Edit = {
  version: 2
  view: "cut" | "full"
  format: "16:9" | "9:16"
  lead_in: number
  lead_out: number
  clips: Clip[]
  restored_gaps: Span[]
  overlays: {
    /** Not shown by the app any more; kept as stored. */
    trail: boolean
    captions: (Span & { text: string })[]
  }
}

export type ReelFormat = Edit["format"]

/** The backend's default and limits for lead_in / lead_out (seconds). */
export const DEFAULT_LEAD = 1
export const MAX_LEAD = 3
export const LEAD_STEP = 0.5

export function normalizeEdit(edit: ReelEdit | undefined): Edit {
  return {
    version: 2,
    view: edit?.view ?? "cut",
    format: edit?.format ?? "16:9",
    lead_in: edit?.lead_in ?? DEFAULT_LEAD,
    lead_out: edit?.lead_out ?? DEFAULT_LEAD,
    clips: (edit?.clips ?? [])
      .map((clip) => ({
        rally_id: clip.rally_id,
        pieces: (clip.pieces ?? []).map((p) => ({
          start: p.start,
          end: p.end,
          slow_mo: p.slow_mo ?? false,
        })),
      }))
      .filter((clip) => clip.pieces.length > 0),
    restored_gaps: edit?.restored_gaps ?? [],
    overlays: {
      trail: edit?.overlays?.trail ?? false,
      captions: edit?.overlays?.captions ?? [],
    },
  }
}

/** Shorter than this (seconds) counts as nothing: no gap, no break, no cut. */
export const MIN_SPAN = 0.05
/** Cut ignores the playhead this close to a piece's edge (no slivers). */
export const MIN_CUT = 0.3
/** Longest caption (the backend's CAPTION_MAX_LENGTH). */
export const CAPTION_MAX = 80

const round3 = (t: number) => Math.round(t * 1000) / 1000
const overlap = (a: Span, b: Span) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start)

/** How long a piece plays in the reel: slow-mo plays at half speed. */
export const pieceLength = (piece: Piece) =>
  (piece.end - piece.start) * (piece.slow_mo ? 2 : 1)

/** Footage a clip keeps (seconds of the match, slow-mo not counted twice). */
export const keptLength = (clip: Clip) =>
  clip.pieces.reduce((sum, p) => sum + (p.end - p.start), 0)

// --- Rally windows --------------------------------------------------------------------

export type Windows = Map<number, Span>

/**
 * Each rally's window: lead_in before it and lead_out after it, inside the video. Two
 * rallies closer than their leads share the gap between them (in proportion to the
 * leads), so windows never overlap and a lead never reaches into another rally.
 */
export function rallyWindows(
  rallies: RallyPublic[],
  lead: { lead_in: number; lead_out: number },
  duration: number,
): Windows {
  const sorted = [...rallies].sort((a, b) => a.start - b.start)
  const windows: Windows = new Map()
  const boundary = (a: RallyPublic, b: RallyPublic) => {
    const gap = b.start - a.end
    const total = lead.lead_in + lead.lead_out
    if (gap <= 0 || total <= 0) return (a.end + b.start) / 2
    return a.end + gap * (lead.lead_out / total)
  }
  sorted.forEach((rally, i) => {
    const previous = sorted[i - 1]
    const next = sorted[i + 1]
    let start = Math.max(0, rally.start - lead.lead_in)
    let end = rally.end + lead.lead_out
    if (duration > 0) end = Math.min(end, duration)
    if (previous) start = Math.max(start, boundary(previous, rally))
    if (next) end = Math.min(end, boundary(rally, next))
    windows.set(rally.id, { start: round3(start), end: round3(end) })
  })
  return windows
}

/** A clip's window, widened to its pieces (a reel saved elsewhere may reach further). */
export function clipWindow(clip: Clip, windows: Windows): Span {
  const window = windows.get(clip.rally_id)
  const first = clip.pieces[0]
  const last = clip.pieces[clip.pieces.length - 1]
  if (!window) return { start: first.start, end: last.end }
  return {
    start: Math.min(window.start, first.start),
    end: Math.max(window.end, last.end),
  }
}

/** A new clip: the whole window as one piece. */
export const clipFromWindow = (rallyId: number, window: Span): Clip => ({
  rally_id: rallyId,
  pieces: [{ start: window.start, end: window.end, slow_mo: false }],
})

/** The clip made from this rally, if it's in the reel. */
export const clipOfRally = (edit: Edit, rallyId: number) =>
  edit.clips.find((clip) => clip.rally_id === rallyId)

/** Add a rally to the reel, in match order. */
export function pickRally(edit: Edit, rallyId: number, window: Span): Edit {
  if (clipOfRally(edit, rallyId)) return edit
  const clips = [...edit.clips, clipFromWindow(rallyId, window)].sort(
    (a, b) => a.pieces[0].start - b.pieces[0].start,
  )
  return { ...edit, clips }
}

/** Take a rally out of the reel (its footage becomes part of the gap around it). */
export function unpickRally(edit: Edit, rallyId: number): Edit {
  return {
    ...edit,
    clips: edit.clips.filter((clip) => clip.rally_id !== rallyId),
  }
}

/**
 * After the windows change (new lead, or rallies fixed): a piece edge that was at its
 * window's edge moves with it (more lead = more footage), and every piece is kept
 * inside the new window. A clip with nothing left is dropped.
 */
export function refit(edit: Edit, before: Windows, after: Windows): Edit {
  const clips = edit.clips.flatMap((clip) => {
    const old = before.get(clip.rally_id)
    const now = after.get(clip.rally_id)
    if (!now) return [clip]
    const pieces = clip.pieces.map((p) => ({ ...p }))
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    if (old && Math.abs(first.start - old.start) < 0.011)
      first.start = now.start
    if (old && Math.abs(last.end - old.end) < 0.011) last.end = now.end
    const kept = pieces
      .map((p) => ({
        ...p,
        start: Math.max(p.start, now.start),
        end: Math.min(p.end, now.end),
      }))
      .filter((p) => p.end - p.start >= MIN_SPAN)
    return kept.length > 0 ? [{ ...clip, pieces: kept }] : []
  })
  return { ...edit, clips }
}

/** New lead_in / lead_out: the windows grow or shrink, and the clips with them. */
export function setLead(
  edit: Edit,
  lead: { lead_in: number; lead_out: number },
  rallies: RallyPublic[],
  duration: number,
): Edit {
  const clampLead = (t: number) =>
    Math.min(MAX_LEAD, Math.max(0, Math.round(t * 100) / 100))
  const next = {
    lead_in: clampLead(lead.lead_in),
    lead_out: clampLead(lead.lead_out),
  }
  const before = rallyWindows(rallies, edit, duration)
  const after = rallyWindows(rallies, next, duration)
  return { ...refit(edit, before, after), ...next }
}

// --- Cutting ----------------------------------------------------------------------------

export type PieceRef = { clipIndex: number; pieceIndex: number }

const replacePieces = (edit: Edit, clipIndex: number, pieces: Piece[]) => ({
  ...edit,
  clips: edit.clips.map((c, i) => (i === clipIndex ? { ...c, pieces } : c)),
})

/** Can the piece be cut at `at`? Not within MIN_CUT of its edges. */
export function canCut(edit: Edit, ref: PieceRef | undefined, at: number) {
  const piece = ref && edit.clips[ref.clipIndex]?.pieces[ref.pieceIndex]
  return Boolean(
    piece && at - piece.start >= MIN_CUT && piece.end - at >= MIN_CUT,
  )
}

/** Split a piece in two at `at` (both halves keep its slow-mo). */
export function cutPiece(edit: Edit, ref: PieceRef, at: number): Edit {
  if (!canCut(edit, ref, at)) return edit
  const pieces = edit.clips[ref.clipIndex].pieces
  const piece = pieces[ref.pieceIndex]
  const t = round3(at)
  return replacePieces(edit, ref.clipIndex, [
    ...pieces.slice(0, ref.pieceIndex),
    { ...piece, end: t },
    { ...piece, start: t },
    ...pieces.slice(ref.pieceIndex + 1),
  ])
}

/** Remove a piece. The last piece takes the rally out of the reel. */
export function deletePiece(edit: Edit, ref: PieceRef): Edit {
  const clip = edit.clips[ref.clipIndex]
  if (!clip?.pieces[ref.pieceIndex]) return edit
  const pieces = clip.pieces.filter((_, i) => i !== ref.pieceIndex)
  if (pieces.length === 0) {
    return { ...edit, clips: edit.clips.filter((_, i) => i !== ref.clipIndex) }
  }
  return replacePieces(edit, ref.clipIndex, pieces)
}

export function toggleSlowMo(edit: Edit, ref: PieceRef): Edit {
  const pieces = edit.clips[ref.clipIndex]?.pieces
  if (!pieces?.[ref.pieceIndex]) return edit
  return replacePieces(
    edit,
    ref.clipIndex,
    pieces.map((p, i) =>
      i === ref.pieceIndex ? { ...p, slow_mo: !p.slow_mo } : p,
    ),
  )
}

/**
 * Put a cut part of a clip back. It joins the pieces it touches (taking the speed of
 * the one before it), so cutting and then restoring gives the original piece back.
 */
export function restoreCut(edit: Edit, clipIndex: number, span: Span): Edit {
  const clip = edit.clips[clipIndex]
  if (!clip) return edit
  const touches = (a: Span, b: Span) => Math.abs(a.end - b.start) < 1e-3
  const before = [...clip.pieces]
    .reverse()
    .find((p) => p.end <= span.start + 1e-3)
  const after = clip.pieces.find((p) => p.start >= span.end - 1e-3)
  let restored: Piece = {
    start: round3(span.start),
    end: round3(span.end),
    slow_mo: before?.slow_mo ?? after?.slow_mo ?? false,
  }
  const pieces = clip.pieces.filter((p) => overlap(p, span) <= 0)
  const merged: Piece[] = []
  for (const piece of pieces) {
    if (
      piece === before &&
      touches(piece, restored) &&
      piece.slow_mo === restored.slow_mo
    ) {
      restored = { ...restored, start: piece.start }
    } else if (
      piece === after &&
      touches(restored, piece) &&
      piece.slow_mo === restored.slow_mo
    ) {
      restored = { ...restored, end: piece.end }
    } else {
      merged.push(piece)
    }
  }
  merged.push(restored)
  merged.sort((a, b) => a.start - b.start)
  return replacePieces(edit, clipIndex, merged)
}

/**
 * One rally's clip with back-to-back pieces of the same speed joined (after a merge,
 * the two rallies' clips meet where their windows did).
 */
export function joinTouching(edit: Edit, rallyId: number): Edit {
  return {
    ...edit,
    clips: edit.clips.map((clip) => {
      if (clip.rally_id !== rallyId) return clip
      const pieces: Piece[] = []
      for (const piece of clip.pieces) {
        const last = pieces[pieces.length - 1]
        if (
          last &&
          Math.abs(piece.start - last.end) < 1e-3 &&
          piece.slow_mo === last.slow_mo
        )
          pieces[pieces.length - 1] = { ...last, end: piece.end }
        else pieces.push(piece)
      }
      return { ...clip, pieces }
    }),
  }
}

// --- Hidden footage ("Rallies only") ------------------------------------------------------

/** What a collapsed gap stands for: breaks between clips and cut parts of clips. */
export type Hidden = {
  regions: Span[]
  cuts: { clipIndex: number; span: Span }[]
}

/** Bring back everything behind a gap: the breaks (restored_gaps) and the cut parts. */
export function restoreHidden(edit: Edit, hidden: Hidden): Edit {
  let next = edit
  for (const cut of hidden.cuts)
    next = restoreCut(next, cut.clipIndex, cut.span)
  for (const region of hidden.regions) {
    next = {
      ...next,
      restored_gaps: [
        ...hideRegion(next, region).restored_gaps,
        { start: round3(region.start), end: round3(region.end) },
      ],
    }
  }
  return next
}

/** Hide a stretch again: drop every restored range that overlaps it. */
export function hideRegion(edit: Edit, region: Span): Edit {
  return {
    ...edit,
    restored_gaps: edit.restored_gaps.filter(
      (gap) => overlap(gap, region) < MIN_SPAN,
    ),
  }
}

// --- Captions ---------------------------------------------------------------------------

/** The caption shown over a stretch (the first one overlapping it). */
export const captionOf = (edit: Edit, span: Span) =>
  edit.overlays.captions.find((c) => overlap(c, span) >= MIN_SPAN)

/** Set (or with an empty text, remove) the caption over a stretch. */
export function setCaption(edit: Edit, span: Span, text: string): Edit {
  const others = edit.overlays.captions.filter(
    (c) => overlap(c, span) < MIN_SPAN,
  )
  const trimmed = text.trim().slice(0, CAPTION_MAX)
  return {
    ...edit,
    overlays: {
      ...edit.overlays,
      captions: trimmed
        ? [...others, { start: span.start, end: span.end, text: trimmed }]
        : others,
    },
  }
}

// --- A new reel ---------------------------------------------------------------------------

/** How many rallies "Make a highlight" picks to start with. */
export const STARTER_PICKS = 5

/** A new reel: the longest few rallies, in match order, each its whole window. */
export function starterEdit(rallies: RallyPublic[], duration: number): Edit {
  const edit = normalizeEdit(undefined)
  const windows = rallyWindows(rallies, edit, duration)
  const longest = [...rallies]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, STARTER_PICKS)
    .sort((a, b) => a.start - b.start)
  return {
    ...edit,
    clips: longest.flatMap((rally) => {
      const window = windows.get(rally.id)
      return window ? [clipFromWindow(rally.id, window)] : []
    }),
  }
}

// --- Rally ids --------------------------------------------------------------------------

/** Point clips at new rally ids (after a rally fix is undone or redone). */
export function remapRallies(edit: Edit, ids: Map<number, number>): Edit {
  if (ids.size === 0) return edit
  return {
    ...edit,
    clips: edit.clips.map((clip) => ({
      ...clip,
      rally_id: ids.get(clip.rally_id) ?? clip.rally_id,
    })),
  }
}

// --- Edit history: one reducer, undo / redo ---------------------------------------------
//
// Every state the user can go back to, oldest first. An entry reached through a rally
// fix (a server change to the match's rallies) carries that fix: undoing it calls the
// reverse endpoint first, redoing it the forward one. Those calls give rallies new ids,
// so the entries on that side of the fix (up to the next fix) get their ids remapped.

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
  | { type: "set-view"; view: Edit["view"] }
  | {
      type: "set-lead"
      lead: { lead_in: number; lead_out: number }
      rallies: RallyPublic[]
      duration: number
    }
  | { type: "pick-rally"; rallyId: number; window: Span }
  | { type: "unpick-rally"; rallyId: number }
  | { type: "restore-hidden"; hidden: Hidden }
  | { type: "hide-region"; region: Span }
  | { type: "restore-cut"; clipIndex: number; span: Span }
  | { type: "cut-piece"; piece: PieceRef; at: number }
  | { type: "delete-piece"; piece: PieceRef }
  | { type: "toggle-slow-mo"; piece: PieceRef }
  | { type: "set-caption"; span: Span; text: string }
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

/** A change: the old state stays on the undo stack, redo is cleared. */
function commit(history: EditHistory, next: Edit): EditHistory {
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
    case "set-view":
      return commit(history, { ...edit, view: action.view })
    case "set-lead":
      return commit(
        history,
        setLead(edit, action.lead, action.rallies, action.duration),
      )
    case "pick-rally":
      return commit(history, pickRally(edit, action.rallyId, action.window))
    case "unpick-rally":
      return commit(history, unpickRally(edit, action.rallyId))
    case "restore-hidden":
      return commit(history, restoreHidden(edit, action.hidden))
    case "hide-region":
      return commit(history, hideRegion(edit, action.region))
    case "restore-cut":
      return commit(history, restoreCut(edit, action.clipIndex, action.span))
    case "cut-piece":
      return commit(history, cutPiece(edit, action.piece, action.at))
    case "delete-piece":
      return commit(history, deletePiece(edit, action.piece))
    case "toggle-slow-mo":
      return commit(history, toggleSlowMo(edit, action.piece))
    case "set-caption":
      return commit(history, setCaption(edit, action.span, action.text))
  }
}
