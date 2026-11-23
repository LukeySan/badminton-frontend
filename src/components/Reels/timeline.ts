import { type Clip, clipLength, MIN_CLIP, round1, type Span } from "./reelEdit"

// The reel on a line: its clips in list order, each with its place in the reel (reel
// time: slow-mo counts double) and on the timeline (pixels at the current zoom). One
// model for the timeline, the time row and preview playback, so they always agree.
//
// Source time can't say where the playhead is in the reel: clips can be in any order
// and overlap (a replay shows the same moment twice). So the screen keeps a *cursor*,
// the clip that is playing, and reel time is "that clip's start in the reel + how far
// into it the video is".

/** Default zoom: pixels per second of reel time (the prototype's scale). */
export const DEFAULT_PX_PER_SECOND = 6
/** Zoom limits (pinch / ctrl + wheel). */
export const MIN_PX_PER_SECOND = 0.5
export const MAX_PX_PER_SECOND = 80
/** Space between clips on the track. */
export const CLIP_GAP = 2
/** Narrowest clip drawn (zoomed far out), so it can still be seen and tapped. */
export const MIN_CLIP_WIDTH = 4

export const clampZoom = (px: number) =>
  Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, px))

export type PlacedClip = {
  clip: Clip
  index: number
  /** In the reel. */
  reel: Span
  /** On the track (px). */
  x: number
  w: number
}

/** Each clip's place in the reel, in list order. */
export function reelSpans(segments: Clip[]): Span[] {
  let t = 0
  return segments.map((clip) => {
    const span = { start: t, end: t + clipLength(clip) }
    t = span.end
    return span
  })
}

export function layOut(
  segments: Clip[],
  pxPerSecond = DEFAULT_PX_PER_SECOND,
): { placed: PlacedClip[]; width: number } {
  let x = 0
  const spans = reelSpans(segments)
  const placed = segments.map((clip, index) => {
    const reel = spans[index]
    const w = Math.max(MIN_CLIP_WIDTH, (reel.end - reel.start) * pxPerSecond)
    const out = { clip, index, reel, x, w }
    x += w + CLIP_GAP
    return out
  })
  return { placed, width: Math.max(0, x - CLIP_GAP) }
}

/** Reel time → x on the track (inside the clip that contains it). */
export function xAtReelTime(placed: PlacedClip[], t: number): number {
  for (const item of placed) {
    if (t <= item.reel.end || item === placed[placed.length - 1]) {
      const length = item.reel.end - item.reel.start
      const into = Math.min(Math.max(0, t - item.reel.start), length)
      return item.x + (length > 0 ? (into / length) * item.w : 0)
    }
  }
  return 0
}

/** x on the track → the clip there and the reel time (the gap after a clip is its end). */
export function atX(
  placed: PlacedClip[],
  x: number,
): { index: number; reelTime: number } | undefined {
  for (const item of placed) {
    if (x < item.x + item.w + CLIP_GAP || item === placed[placed.length - 1]) {
      const into = Math.min(Math.max(0, x - item.x), item.w)
      const length = item.reel.end - item.reel.start
      return {
        index: item.index,
        reelTime: item.reel.start + (item.w > 0 ? (into / item.w) * length : 0),
      }
    }
  }
  return undefined
}

/** Reel time → the clip playing then and the moment of the video it shows. */
export function atReelTime(
  segments: Clip[],
  t: number,
): { index: number; source: number } | undefined {
  const spans = reelSpans(segments)
  for (let i = 0; i < segments.length; i++) {
    if (t < spans[i].end || i === segments.length - 1) {
      const clip = segments[i]
      const into = Math.min(Math.max(0, t - spans[i].start), clipLength(clip))
      return {
        index: i,
        source: clip.start + into / (clip.slow_mo ? 2 : 1),
      }
    }
  }
  return undefined
}

/** The reel time when clip `index` shows the video at `source` (clamped to the clip). */
export function reelTimeIn(
  segments: Clip[],
  index: number,
  source: number,
): number {
  const clip = segments[index]
  if (!clip) return 0
  const start = reelSpans(segments)[index].start
  const into = Math.min(Math.max(0, source - clip.start), clip.end - clip.start)
  return start + into * (clip.slow_mo ? 2 : 1)
}

/** Within this distance of a clip's start counts as inside it (seeks land a hair early). */
export const EDGE_EPSILON = 0.05

/** The first clip (in list order) that shows the video at `source`. */
export const clipIndexAt = (segments: Clip[], source: number) =>
  segments.findIndex(
    (clip) => source >= clip.start - EDGE_EPSILON && source < clip.end,
  )

/** Ruler step: the smallest "nice" number of seconds that puts ticks ≥ 48 px apart. */
export function rulerStep(pxPerSecond: number) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((s) => s * pxPerSecond >= 48) ?? steps[steps.length - 1]
}

/** Ruler ticks every `step` seconds of reel time, placed inside the clips. */
export function rulerTicks(placed: PlacedClip[], step: number) {
  const ticks: { t: number; x: number }[] = []
  for (const item of placed) {
    const length = item.reel.end - item.reel.start
    if (length <= 0) continue
    for (
      let t = Math.ceil(item.reel.start / step - 1e-9) * step;
      t < item.reel.end - 1e-9;
      t += step
    ) {
      ticks.push({ t, x: item.x + ((t - item.reel.start) / length) * item.w })
    }
  }
  return ticks
}

// --- Dragging a clip's edge -------------------------------------------------------------

/** An edge within this many pixels of a snap point (a rally's detected start / end) jumps to it. */
export const SNAP_PX = 10

/**
 * Where a clip's bounds are after dragging one edge `dx` pixels from `origin`. The edge
 * snaps to a detected rally boundary within SNAP_PX, else to 0.1 s; it can go anywhere
 * in the video, but the clip stays at least MIN_CLIP long. `pxPerSecond` is pixels
 * per second of *source* time (slow-mo clips are drawn twice as wide).
 */
export function dragEdge({
  origin,
  edge,
  dx,
  pxPerSecond,
  snaps,
  duration,
}: {
  origin: Span
  edge: "start" | "end"
  dx: number
  pxPerSecond: number
  snaps: number[]
  duration: number
}): { span: Span; snapped: number | undefined } {
  const raw = (edge === "start" ? origin.start : origin.end) + dx / pxPerSecond
  let snapped: number | undefined
  let best = SNAP_PX
  for (const point of snaps) {
    const distance = Math.abs(point - raw) * pxPerSecond
    if (distance <= best) {
      best = distance
      snapped = point
    }
  }
  const limit =
    duration > 0
      ? Math.floor(duration * 10 + 1e-6) / 10
      : Number.POSITIVE_INFINITY
  const t = round1(snapped ?? raw)
  if (edge === "start") {
    const start = Math.min(Math.max(0, t), round1(origin.end - MIN_CLIP))
    return {
      span: { start, end: origin.end },
      snapped:
        snapped !== undefined && start === round1(snapped)
          ? snapped
          : undefined,
    }
  }
  const end = Math.max(Math.min(limit, t), round1(origin.start + MIN_CLIP))
  return {
    span: { start: origin.start, end },
    snapped:
      snapped !== undefined && end === round1(snapped) ? snapped : undefined,
  }
}
