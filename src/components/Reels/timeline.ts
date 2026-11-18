import type { Segment } from "@/components/Player/rallies"
import {
  type Clip,
  clipCuts,
  clipWindow,
  type Edit,
  type Hidden,
  hiddenRegions,
  isRestored,
  MIN_SPAN,
  type Piece,
  pieceLength,
  type Span,
  stretches,
  type Windows,
} from "./reelEdit"

// The reel as a sequence of items, in reel order, each with its place in the source
// video (`src`) and in the reel (`reel`). One model for the timeline, the time row and
// preview playback, so they always agree.
//
// "Rallies only": the clips' pieces back to back. The footage between them (breaks,
// unpicked rallies, deleted parts of clips) collapses into zero-length gap markers,
// except a stretch with a restored anchor inside: it plays, shown as breaks and
// unpicked rallies. Deleted parts (cuts) never play. This is what an export renders.
// "Full video": everything, unpicked rallies faint, cut parts as pink stripes.

export type TimelineItem =
  | {
      kind: "piece"
      key: string
      clipIndex: number
      pieceIndex: number
      /** How many pieces its clip has ("part 2 of 3"). */
      pieceCount: number
      clip: Clip
      piece: Piece
      segment: Segment | undefined
      src: Span
      reel: Span
    }
  /** A cut part of a clip, shown in "Full video" (tap to put it back). */
  | {
      kind: "cut"
      key: string
      clipIndex: number
      segment: Segment | undefined
      src: Span
      reel: Span
    }
  | { kind: "break"; key: string; region: Span; src: Span; reel: Span }
  | {
      kind: "unpicked"
      key: string
      region: Span
      segment: Segment
      src: Span
      reel: Span
    }
  /** Hidden footage in "Rallies only": no reel time, tap to bring it back. */
  | { kind: "gap"; key: string; hidden: Hidden; src: Span; reel: Span }

export function buildTimeline(
  edit: Edit,
  segments: Segment[],
  windows: Windows,
  duration: number,
): TimelineItem[] {
  return edit.view === "full"
    ? buildFullVideo(edit, segments, windows, duration)
    : buildRalliesOnly(edit, segments, windows, duration)
}

/** Items in reel order, each given its reel time as it's shown. Hidden footage
 *  collects until the next shown item, then becomes one gap marker before it. */
function sequence() {
  const items: TimelineItem[] = []
  let reelTime = 0
  let hidden: Hidden = { regions: [], cuts: [] }

  const flush = () => {
    const spans = [...hidden.regions, ...hidden.cuts.map((c) => c.span)]
    if (spans.length === 0) return
    const start = Math.min(...spans.map((s) => s.start))
    const end = Math.max(...spans.map((s) => s.end))
    items.push({
      kind: "gap",
      key: `gap-${start}`,
      hidden,
      src: { start, end },
      reel: { start: reelTime, end: reelTime },
    })
    hidden = { regions: [], cuts: [] }
  }
  const show = (item: TimelineItem, length: number) => {
    flush()
    item.reel = { start: reelTime, end: reelTime + length }
    items.push(item)
    reelTime += length
  }
  const hide = (more: Hidden) => {
    hidden.regions.push(...more.regions)
    hidden.cuts.push(...more.cuts)
  }
  return { items, flush, show, hide }
}

type Sequence = ReturnType<typeof sequence>
const NO_TIME = { start: 0, end: 0 }

/** A stretch that plays between clips: unpicked rallies (faint, tap to add) and the
 *  breaks around them. Tapping either hides `region` again. */
function showFootage(
  seq: Sequence,
  region: Span,
  segments: Segment[],
  pickedIds: Set<number>,
) {
  let cursor = region.start
  const footage = (from: number, to: number) => {
    if (to - from < MIN_SPAN) return
    seq.show(
      {
        kind: "break",
        key: `break-${from}`,
        region,
        src: { start: from, end: to },
        reel: NO_TIME,
      },
      to - from,
    )
  }
  for (const segment of segments) {
    const { rally } = segment
    if (pickedIds.has(rally.id)) continue
    const from = Math.max(region.start, rally.start)
    const to = Math.min(region.end, rally.end)
    if (to - from < MIN_SPAN) continue
    footage(cursor, from)
    seq.show(
      {
        kind: "unpicked",
        key: `rally-${rally.id}`,
        region,
        segment,
        src: { start: from, end: to },
        reel: NO_TIME,
      },
      to - from,
    )
    cursor = to
  }
  footage(cursor, region.end)
}

const pieceItem = (
  clip: Clip,
  clipIndex: number,
  piece: Piece,
  pieceIndex: number,
  segment: Segment | undefined,
): TimelineItem => ({
  kind: "piece",
  key: `clip-${clipIndex}-${clip.rally_id}-${pieceIndex}`,
  clipIndex,
  pieceIndex,
  pieceCount: clip.pieces.length,
  clip,
  piece,
  segment,
  src: { start: piece.start, end: piece.end },
  reel: NO_TIME,
})

/**
 * "Rallies only", the result the export renders (the backend's export_snapshot.py
 * applies the same rule; shared fixtures check both): the pieces in reel order, and
 * the footage no piece covers (hiddenRegions) split by the clips' cuts into
 * stretches. A stretch plays if a restored anchor is inside it; cuts never play.
 * Hidden parts collapse into gap markers. A stretch goes right before the first
 * piece (in reel order) that starts where it ends or later.
 */
function buildRalliesOnly(
  edit: Edit,
  segments: Segment[],
  _windows: Windows,
  duration: number,
): TimelineItem[] {
  const seq = sequence()
  const pickedIds = new Set(edit.clips.map((clip) => clip.rally_id))
  const limit = duration > 0 ? duration : Number.POSITIVE_INFINITY
  const cuts = clipCuts(edit, duration)
  const allStretches = stretches(edit, duration)

  /** A stretch no piece covers, in time order: its cuts (always hidden; a gap
   *  marker over one puts it back into its clip) and the stretches between them
   *  (played if restored; else a gap marker over one adds an anchor). */
  const place = (region: Span) => {
    const inside = (span: Span) =>
      span.start >= region.start - 1e-9 && span.end <= region.end + 1e-9
    const parts: (
      | { cut: { clipIndex: number; span: Span } }
      | { stretch: Span }
    )[] = [
      ...cuts.filter((c) => inside(c.span)).map((cut) => ({ cut })),
      ...allStretches.filter(inside).map((stretch) => ({ stretch })),
    ]
    const startOf = (p: (typeof parts)[number]) =>
      "cut" in p ? p.cut.span.start : p.stretch.start
    const taken: Span[] = []
    for (const part of parts.sort((a, b) => startOf(a) - startOf(b))) {
      if ("cut" in part) {
        const { span } = part.cut
        // A replay's cuts may repeat another clip's: the first one claims them
        const overlaps = taken.some(
          (t) => Math.min(t.end, span.end) - Math.max(t.start, span.start) > 0,
        )
        if (!overlaps) seq.hide({ regions: [], cuts: [part.cut] })
        taken.push(span)
      } else if (isRestored(part.stretch, edit.restored_anchors)) {
        showFootage(seq, part.stretch, segments, pickedIds)
      } else {
        seq.hide({ regions: [part.stretch], cuts: [] })
      }
    }
  }

  const pending = hiddenRegions(edit, duration)
  edit.clips.forEach((clip, clipIndex) => {
    const segment = segments.find((s) => s.rally.id === clip.rally_id)
    clip.pieces.forEach((piece, pieceIndex) => {
      // The same pieces hiddenRegions keeps (cut to the video, no slivers)
      if (Math.min(piece.end, limit) - Math.max(0, piece.start) < MIN_SPAN)
        return
      while (pending.length > 0 && pending[0].end <= piece.start)
        place(pending.shift() as Span)
      seq.show(
        pieceItem(clip, clipIndex, piece, pieceIndex, segment),
        pieceLength(piece),
      )
    })
  })
  for (const region of pending) place(region)
  seq.flush()
  return seq.items
}

/**
 * "Full video": everything in time order around the clips. Unpicked rallies are
 * faint, cut parts of clips are pink stripes (tap to put them back); only the pieces
 * are in the reel.
 */
function buildFullVideo(
  edit: Edit,
  segments: Segment[],
  windows: Windows,
  duration: number,
): TimelineItem[] {
  const seq = sequence()
  const pickedIds = new Set(edit.clips.map((clip) => clip.rally_id))

  const addRegion = (start: number, end: number) => {
    if (end - start >= MIN_SPAN)
      showFootage(seq, { start, end }, segments, pickedIds)
  }
  const addCut = (
    clipIndex: number,
    segment: Segment | undefined,
    start: number,
    end: number,
  ) => {
    if (end - start < MIN_SPAN) return
    seq.show(
      {
        kind: "cut",
        key: `cut-${clipIndex}-${start}`,
        clipIndex,
        segment,
        src: { start, end },
        reel: NO_TIME,
      },
      end - start,
    )
  }

  let cursor = 0
  edit.clips.forEach((clip, clipIndex) => {
    const window = clipWindow(clip, windows)
    const segment = segments.find((s) => s.rally.id === clip.rally_id)
    const start = Math.max(cursor, window.start)
    addRegion(cursor, start)
    let position = start
    clip.pieces.forEach((piece, pieceIndex) => {
      addCut(clipIndex, segment, position, piece.start)
      seq.show(
        pieceItem(clip, clipIndex, piece, pieceIndex, segment),
        pieceLength(piece),
      )
      position = Math.max(position, piece.end)
    })
    addCut(clipIndex, segment, position, window.end)
    cursor = Math.max(cursor, window.end, position)
  })
  addRegion(cursor, Math.max(cursor, duration))
  seq.flush()
  return seq.items
}

/** The reel's length: where the last item ends. */
export const timelineLength = (items: TimelineItem[]) =>
  items.length ? items[items.length - 1].reel.end : 0

// --- Layout: pixels on the timeline ---------------------------------------------

/** Pixels per second of reel time (the prototype's scale). */
export const PX_PER_SECOND = 6
/** Space between items. */
export const ITEM_GAP = 2
/** A collapsed gap marker's width. */
export const GAP_WIDTH = 40
/** A cut part is at least this wide, so it can be tapped. */
const CUT_MIN_WIDTH = 14
/** Narrowest item drawn (a very short break). */
const MIN_WIDTH = 2

export type PlacedItem = TimelineItem & { x: number; w: number }

export function layOut(
  items: TimelineItem[],
  pxPerSecond = PX_PER_SECOND,
): { placed: PlacedItem[]; width: number } {
  let x = 0
  const placed = items.map((item) => {
    const w =
      item.kind === "gap"
        ? GAP_WIDTH
        : Math.max(
            item.kind === "cut" ? CUT_MIN_WIDTH : MIN_WIDTH,
            (item.reel.end - item.reel.start) * pxPerSecond,
          )
    const out = { ...item, x, w }
    x += w + ITEM_GAP
    return out
  })
  return { placed, width: Math.max(0, x - ITEM_GAP) }
}

const reelLengthOf = (item: TimelineItem) => item.reel.end - item.reel.start

/** Reel time → x (the left edge of the item that contains it, scaled within it). */
export function xAtReelTime(placed: PlacedItem[], t: number): number {
  for (const item of placed) {
    const length = reelLengthOf(item)
    if (length <= 0) continue
    if (t <= item.reel.end || item === placed[placed.length - 1]) {
      const into = Math.min(Math.max(0, t - item.reel.start), length)
      return item.x + (into / length) * item.w
    }
  }
  return 0
}

/** x → reel time (a gap marker maps to the moment it sits at). */
export function reelTimeAtX(placed: PlacedItem[], x: number): number {
  for (const item of placed) {
    if (x < item.x + item.w + ITEM_GAP || item === placed[placed.length - 1]) {
      const length = reelLengthOf(item)
      if (length <= 0) return item.reel.start
      const into = Math.min(Math.max(0, x - item.x), item.w)
      return item.reel.start + (into / item.w) * length
    }
  }
  return 0
}

/** Reel time → the moment in the source video that plays then. */
export function sourceAtReelTime(
  items: TimelineItem[],
  t: number,
): number | undefined {
  for (const item of items) {
    const length = reelLengthOf(item)
    if (length <= 0) continue
    if (t < item.reel.end || item === items[items.length - 1]) {
      const into = Math.min(Math.max(0, t - item.reel.start), length)
      const srcLength = item.src.end - item.src.start
      return item.src.start + (into / length) * srcLength
    }
  }
  return undefined
}

/**
 * Source time → reel time. Footage hidden in "Rallies only" maps to its gap marker,
 * so the playhead waits at the gap while the video is there.
 */
export function reelTimeAtSource(items: TimelineItem[], s: number): number {
  for (const item of items) {
    if (s >= item.src.start && s < item.src.end) {
      const srcLength = item.src.end - item.src.start
      const length = reelLengthOf(item)
      if (length <= 0) return item.reel.start
      return item.reel.start + ((s - item.src.start) / srcLength) * length
    }
  }
  const last = items[items.length - 1]
  return last ? last.reel.end : 0
}

/** The piece playing at a source time, if any. */
export function pieceAtSource(items: TimelineItem[], s: number) {
  const item = items.find(
    (i) => i.kind === "piece" && s >= i.src.start && s < i.src.end,
  )
  return item?.kind === "piece" ? item : undefined
}
