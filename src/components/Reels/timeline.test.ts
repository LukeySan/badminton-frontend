/// <reference types="bun" />
// The reel on a line: reel time ↔ clips ↔ pixels, and dragging an edge (snapping).
// Run: `bun run test:unit`.

import { describe, expect, test } from "bun:test"
import type { Clip } from "./reelEdit"
import {
  atReelTime,
  atX,
  clipIndexAt,
  dragEdge,
  layOut,
  reelSpans,
  reelTimeIn,
  rulerStep,
  xAtReelTime,
} from "./timeline"

const clip = (
  id: string,
  start: number,
  end: number,
  slow_mo = false,
): Clip => ({ id, start, end, slow_mo, rally_id: null })
// A replay: the same moment twice, out of time order, one in slow-mo
const REEL = [clip("a", 10, 20), clip("b", 30, 35), clip("c", 12, 14, true)]

describe("reel time", () => {
  test("clips in list order; slow-mo counts double", () => {
    expect(reelSpans(REEL)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 15 },
      { start: 15, end: 19 },
    ])
  })

  test("reel time → clip and source; and back, in the cursor's clip", () => {
    expect(atReelTime(REEL, 3)).toEqual({ index: 0, source: 13 })
    expect(atReelTime(REEL, 16)).toEqual({ index: 2, source: 12.5 })
    // 13 s of the video is in clip a (reel 3 s) and in the replay c (reel 17 s)
    expect(reelTimeIn(REEL, 0, 13)).toBe(3)
    expect(reelTimeIn(REEL, 2, 13)).toBe(17)
    expect(clipIndexAt(REEL, 13)).toBe(0)
    expect(clipIndexAt(REEL, 40)).toBe(-1)
  })
})

describe("layout", () => {
  test("pixels per second, 2 px between clips, any zoom", () => {
    const { placed, width } = layOut(REEL, 6)
    expect(placed.map((p) => [p.x, p.w])).toEqual([
      [0, 60],
      [62, 30],
      [94, 24],
    ])
    expect(width).toBe(118)
    expect(xAtReelTime(placed, 12)).toBe(74)
    expect(atX(placed, 74)).toEqual({ index: 1, reelTime: 12 })
    // The gap after a clip is its end
    expect(atX(placed, 61)).toEqual({ index: 0, reelTime: 10 })
    const zoomed = layOut(REEL, 24)
    expect(xAtReelTime(zoomed.placed, 12)).toBe(24 * 12 + 2)
  })

  test("ruler ticks stay readable at every zoom", () => {
    expect(rulerStep(6)).toBe(10)
    expect(rulerStep(80)).toBe(1)
    expect(rulerStep(0.5)).toBe(120)
  })
})

describe("dragging an edge", () => {
  const base = {
    origin: { start: 10, end: 20 },
    pxPerSecond: 6,
    snaps: [11, 22.3],
    duration: 60,
  }

  test("snaps to a detected rally boundary within 10 px, else to 0.1 s", () => {
    // 2.2 s out → 22.2, 0.6 px from 22.3: snapped
    expect(dragEdge({ ...base, edge: "end", dx: 13.2 })).toEqual({
      span: { start: 10, end: 22.3 },
      snapped: 22.3,
    })
    // 4 s out: 1.7 s past it (10 px+), no snap
    expect(dragEdge({ ...base, edge: "end", dx: 24 })).toEqual({
      span: { start: 10, end: 24 },
      snapped: undefined,
    })
    // 0.13 s: rounded to the 0.1 s grid
    expect(
      dragEdge({ ...base, snaps: [], edge: "start", dx: -0.78 }).span,
    ).toEqual({ start: 9.9, end: 20 })
    // Inward to the detected start
    expect(dragEdge({ ...base, edge: "start", dx: 5 }).span).toEqual({
      start: 11,
      end: 20,
    })
  })

  test("never shorter than 0.3 s, never outside the video", () => {
    expect(dragEdge({ ...base, edge: "end", dx: -200 }).span).toEqual({
      start: 10,
      end: 10.3,
    })
    expect(dragEdge({ ...base, edge: "start", dx: -600 }).span).toEqual({
      start: 0,
      end: 20,
    })
    expect(
      dragEdge({ ...base, duration: 25.04, edge: "end", dx: 600 }).span,
    ).toEqual({ start: 10, end: 25 })
  })

  test("a slow-mo clip is drawn twice as wide: same finger, half the time", () => {
    expect(
      dragEdge({ ...base, snaps: [], pxPerSecond: 12, edge: "end", dx: 12 })
        .span,
    ).toEqual({ start: 10, end: 21 })
  })
})
