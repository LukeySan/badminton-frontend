import type { ReelClip } from "@/client"
import type { Segment } from "@/components/Player/rallies"
import { clipLength, type Edit, MIN_SPAN, regionShown } from "./reelEdit"

// The reel as a sequence of items, in reel order, each with its place in the source
// video (`src`) and in the reel (`reel`). One model for the timeline, the time row
// and (later) preview playback, so they always agree.
//
// "Rallies only": clips back to back; the footage between them is a zero-length gap
// marker unless it was restored, then it's shown as breaks and unpicked rallies.
// "Full video": everything, unpicked rallies faint.

type Span = { start: number; end: number }

export type TimelineItem =
  | {
      kind: "clip"
      key: string
      clipIndex: number
      clip: ReelClip
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
  | { kind: "gap"; key: string; region: Span; src: Span; reel: Span }

export function buildTimeline(
  edit: Edit,
  segments: Segment[],
  duration: number,
): TimelineItem[] {
  const items: TimelineItem[] = []
  const pickedIds = new Set(edit.clips.map((clip) => clip.rally_id))
  let reelTime = 0

  const addRegion = (start: number, end: number) => {
    if (end - start < MIN_SPAN) return
    const region = { start, end }
    const restored = edit.restored_gaps.some(
      (gap) => Math.min(gap.end, end) - Math.max(gap.start, start) >= MIN_SPAN,
    )
    if (!regionShown(edit, { ...region, restored })) {
      items.push({
        kind: "gap",
        key: `gap-${start}`,
        region,
        src: region,
        reel: { start: reelTime, end: reelTime },
      })
      return
    }
    // Shown: unpicked rallies (faint, tap to add) and the breaks between them.
    let cursor = start
    const footage = (kind: "break", from: number, to: number) => {
      if (to - from < MIN_SPAN) return
      items.push({
        kind,
        key: `${kind}-${from}`,
        region,
        src: { start: from, end: to },
        reel: { start: reelTime, end: reelTime + (to - from) },
      })
      reelTime += to - from
    }
    for (const segment of segments) {
      const { rally } = segment
      if (pickedIds.has(rally.id)) continue
      const from = Math.max(start, rally.start)
      const to = Math.min(end, rally.end)
      if (to - from < MIN_SPAN) continue
      footage("break", cursor, from)
      items.push({
        kind: "unpicked",
        key: `rally-${rally.id}`,
        region,
        segment,
        src: { start: from, end: to },
        reel: { start: reelTime, end: reelTime + (to - from) },
      })
      reelTime += to - from
      cursor = to
    }
    footage("break", cursor, end)
  }

  let cursor = 0
  edit.clips.forEach((clip, clipIndex) => {
    addRegion(cursor, clip.trim_start)
    const length = clipLength(clip)
    items.push({
      kind: "clip",
      key: `clip-${clipIndex}-${clip.rally_id}`,
      clipIndex,
      clip,
      segment: segments.find((s) => s.rally.id === clip.rally_id),
      src: { start: clip.trim_start, end: clip.trim_end },
      reel: { start: reelTime, end: reelTime + length },
    })
    reelTime += length
    cursor = Math.max(cursor, clip.trim_end)
  })
  addRegion(cursor, Math.max(cursor, duration))
  return items
}

// --- Layout: pixels on the timeline ---------------------------------------------

/** Pixels per second of reel time (the prototype's scale). */
export const PX_PER_SECOND = 6
/** Space between items. */
export const ITEM_GAP = 2
/** A collapsed gap marker's width. */
export const GAP_WIDTH = 40
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
        : Math.max(MIN_WIDTH, (item.reel.end - item.reel.start) * pxPerSecond)
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

/** The clip playing at a source time, if any. */
export function clipIndexAtSource(
  items: TimelineItem[],
  s: number,
): number | undefined {
  const item = items.find(
    (i) => i.kind === "clip" && s >= i.src.start && s < i.src.end,
  )
  return item?.kind === "clip" ? item.clipIndex : undefined
}
