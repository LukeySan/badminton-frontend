import type { TextOverlay as ApiTextOverlay } from "@/client"

// Overlays (edit list v6): things drawn on top of the reel, on the reel's own
// timeline. Each has an id, a time span in REEL seconds (clips back to back, slow-mo
// counted double; stored to 0.1 s, at least 0.3 s), a position (x, y = its centre
// as fractions of the output frame) and a size (font size as a fraction of the
// frame's height). Drawn in list order, later ones on top.
//
// Types: "text" now. "score" is reserved by the backend (same timing, position and
// size; no stored content, it will show the scored match's score): it will reuse
// the overlay box with its own renderer and no text editing.
//
// The geometry below is the export's (backend worker/caption_image.py): the preview
// must put every box exactly where the exported video will have it.

export type TextOverlay = ApiTextOverlay & { size: number }
/** Every overlay type (one for now). */
export type Overlay = TextOverlay
export type OverlayType = Overlay["type"]

/** Most overlays in a reel (the backend's MAX_OVERLAYS). */
export const MAX_OVERLAYS = 20
/** Shortest overlay, in seconds (the backend's MIN_OVERLAY_SECONDS). */
export const MIN_OVERLAY = 0.3
/** Longest text (the backend's OVERLAY_TEXT_MAX_LENGTH). */
export const OVERLAY_TEXT_MAX = 80
/** Size limits and default (fraction of the frame's height; the backend's). */
export const OVERLAY_SIZE = { min: 0.03, max: 0.15, default: 0.06 }
/** A new text lasts this long (seconds of reel time). */
export const NEW_OVERLAY_SECONDS = 3

// --- The export's box geometry (caption_image.py) ----------------------------------

/** Box padding, corner radius and the gap between lines, in ems of the font size. */
export const BOX = { padX: 0.7, padY: 0.3, radius: 0.5, lineGap: 0.1 }
/** Boxes stay this far from every edge: a fraction of the frame's shorter side. */
export const SAFE_MARGIN = 0.03
/**
 * The fonts' ascent and descent (ems; their hhea metrics, which Pillow and browsers
 * both use). The export makes each line max ascent + max descent of the fonts in it
 * tall, with lineGap between lines. CSS gets the same pitch when every run's line
 * height is its font's ascent + descent + lineGap (half of the gap above and below
 * it), and the box's vertical padding gives back the half gaps above the first line
 * and below the last.
 */
export const FONT_METRICS = {
  latin: { ascent: 1.066, descent: 0.3 },
  thai: { ascent: 1.061, descent: 0.45 },
}
export const lineHeight = (font: keyof typeof FONT_METRICS) =>
  FONT_METRICS[font].ascent + FONT_METRICS[font].descent + BOX.lineGap

export const safeMargin = (width: number, height: number) =>
  Math.min(width, height) * SAFE_MARGIN

/**
 * Where a box goes along one axis (top-left, px): centred on `centre`, moved inside
 * the margins; a box larger than the room between them is centred in the frame
 * (the export's `place`).
 */
export function placeBox(
  centre: number,
  length: number,
  frame: number,
  margin: number,
): number {
  if (length > frame - 2 * margin) return (frame - length) / 2
  return Math.min(
    Math.max(centre - length / 2, margin),
    frame - margin - length,
  )
}

/**
 * The centre (fraction of the frame) a box of `length` px can have so that it stays
 * inside the margins: what a drag stores, so the export's clamp has nothing to do.
 */
export function clampCentre(
  centre: number,
  length: number,
  frame: number,
  margin: number,
): number {
  if (frame <= 0) return centre
  return (placeBox(centre * frame, length, frame, margin) + length / 2) / frame
}

// --- Line breaks -------------------------------------------------------------------

const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "word" })
    : undefined

/**
 * Where a line may break: the text cut after each word, with the spaces and
 * punctuation that follow it (a line never starts with them). Thai has no spaces:
 * its words come from ICU's dictionary (Intl.Segmenter), the same breaks browsers
 * use for CSS and the export uses (PyICU). Checked against the shared fixture
 * (lineBreaks.fixtures.test.ts).
 */
export function linePieces(text: string): string[] {
  if (!wordSegmenter) return text.split(/(?<=\s)/)
  const out: string[] = []
  for (const s of wordSegmenter.segment(text)) {
    if (!s.isWordLike && out.length) out[out.length - 1] += s.segment
    else out.push(s.segment)
  }
  return out
}

/** Characters drawn with the Thai font (Manrope has none of them). */
export const THAI = /[฀-๿]/

/** A piece split into runs of Thai and other characters (each font has its own line height). */
export function fontRuns(text: string): { text: string; thai: boolean }[] {
  const runs: { text: string; thai: boolean }[] = []
  for (const char of text) {
    const thai = THAI.test(char)
    const last = runs[runs.length - 1]
    // Spaces and punctuation stay in the run they're in (like the export)
    if (last && (last.thai === thai || /[\s\p{P}]/u.test(char)))
      last.text += char
    else runs.push({ text: char, thai })
  }
  return runs
}

/** Text as it's stored: one line (no line breaks), trimmed, at most 80 characters. */
export const cleanText = (text: string) =>
  [...text.replace(/\s+/g, " ").trim()].slice(0, OVERLAY_TEXT_MAX).join("")

// --- Time ----------------------------------------------------------------------------

/** Seconds to the 0.1 s the backend stores. */
const round1 = (t: number) => Math.round(t * 10) / 10

/** Reel times within this of an edge count as on it (seeks land a hair early). */
const TIME_EPSILON = 0.02

/** Is it on screen at reel time `t`? ([start, end), like the export.) */
export const isActive = (overlay: Overlay, t: number) =>
  t >= overlay.start - TIME_EPSILON && t < overlay.end - TIME_EPSILON

/**
 * A time span made valid for a reel `length` seconds long: on the 0.1 s grid, inside
 * the reel, at least MIN_OVERLAY (`keep`: the edge that stays when it's too short).
 */
export function fitOverlaySpan(
  span: { start: number; end: number },
  length: number,
  keep: "start" | "end" = "start",
): { start: number; end: number } {
  const limit = length > 0 ? round1(length) : Number.POSITIVE_INFINITY
  let start = Math.min(Math.max(0, round1(span.start)), limit)
  let end = Math.min(Math.max(0, round1(span.end)), limit)
  if (end - start < MIN_OVERLAY - 1e-9) {
    if (keep === "start") end = Math.min(limit, round1(start + MIN_OVERLAY))
    else start = Math.max(0, round1(end - MIN_OVERLAY))
    if (end - start < MIN_OVERLAY - 1e-9) {
      if (keep === "start") start = Math.max(0, round1(end - MIN_OVERLAY))
      else end = Math.min(limit, round1(start + MIN_OVERLAY))
    }
  }
  return { start, end }
}

/**
 * Keep every overlay inside a reel `length` seconds long, as the backend does when it
 * saves: one running past the end is cut there, one starting too late to show 0.3 s
 * moves to the last 0.3 s. A reel with no length yet keeps them as they are.
 */
export function clampToReel<T extends Overlay>(overlays: T[], length: number) {
  if (length <= 0) return overlays
  const end = round1(length)
  const latestStart = round1(Math.max(0, end - MIN_OVERLAY))
  let changed = false
  const out = overlays.map((overlay) => {
    if (overlay.end <= end + 1e-9) return overlay
    changed = true
    return { ...overlay, end, start: Math.min(overlay.start, latestStart) }
  })
  return changed ? out : overlays
}

// --- Changes -------------------------------------------------------------------------

/** Ids for new overlays, unique in the list ("o1", "o2"...). */
export function newOverlayId(overlays: Overlay[]): string {
  const used = new Set(overlays.map((o) => o.id))
  let n = overlays.length + 1
  while (used.has(`o${n}`)) n++
  return `o${n}`
}

/** A new text at reel time `at`: NEW_OVERLAY_SECONDS long, centred, default size. */
export function newTextOverlay({
  id,
  at,
  length,
  text,
}: {
  id: string
  at: number
  /** The reel's length (seconds). */
  length: number
  text: string
}): TextOverlay {
  // Down to the 0.1 s step, so the playhead is inside it (it shows right away)
  const start =
    Math.floor(
      Math.max(0, Math.min(at, length > 0 ? length - MIN_OVERLAY : at)) * 10 +
        1e-6,
    ) / 10
  return {
    id,
    type: "text",
    ...fitOverlaySpan({ start, end: start + NEW_OVERLAY_SECONDS }, length),
    x: 0.5,
    y: 0.5,
    size: OVERLAY_SIZE.default,
    text: cleanText(text),
  }
}

/** What a change to an overlay's look may touch (one undo step each). */
export type OverlayPatch = Partial<
  Pick<TextOverlay, "x" | "y" | "size" | "text">
>

/** The patch made valid: position inside the frame, size in range, text cleaned (an empty text changes nothing). */
export function cleanPatch(patch: OverlayPatch): OverlayPatch {
  const out: OverlayPatch = {}
  const fraction = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4
  if (patch.x !== undefined) out.x = fraction(patch.x)
  if (patch.y !== undefined) out.y = fraction(patch.y)
  if (patch.size !== undefined)
    out.size =
      Math.round(
        Math.min(OVERLAY_SIZE.max, Math.max(OVERLAY_SIZE.min, patch.size)) *
          1e4,
      ) / 1e4
  if (patch.text !== undefined) {
    const text = cleanText(patch.text)
    if (text) out.text = text
  }
  return out
}

/** Can the overlay be cut at reel time `at`? Both parts at least MIN_OVERLAY. */
export function canCutOverlay(overlay: Overlay | undefined, at: number) {
  if (!overlay) return false
  const t = round1(at)
  return (
    t - overlay.start >= MIN_OVERLAY - 1e-9 &&
    overlay.end - t >= MIN_OVERLAY - 1e-9
  )
}

/** Split an overlay at `at`: two with the same look, the second is `newId` (right after it in the list). */
export function cutOverlay(
  overlays: Overlay[],
  id: string,
  at: number,
  newId: string,
): Overlay[] {
  const i = overlays.findIndex((o) => o.id === id)
  const overlay = overlays[i]
  if (!canCutOverlay(overlay, at) || overlays.length >= MAX_OVERLAYS)
    return overlays
  const t = round1(at)
  const out = [...overlays]
  out.splice(i, 1, { ...overlay, end: t }, { ...overlay, id: newId, start: t })
  return out
}
