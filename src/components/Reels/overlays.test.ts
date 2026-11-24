/// <reference types="bun" />
// Overlays (edit list v6): text on the reel's own timeline. The model, the export's
// geometry, the reducer's overlay actions (one undo step each) and dragging a bar on
// the timeline. Run: `bun run test:unit`.

import { describe, expect, test } from "bun:test"
import {
  canCutOverlay,
  clampCentre,
  clampToReel,
  cleanPatch,
  cleanText,
  cutOverlay,
  fitOverlaySpan,
  fontRuns,
  isActive,
  linePieces,
  MAX_OVERLAYS,
  newOverlayId,
  newTextOverlay,
  type Overlay,
  placeBox,
} from "./overlays"
import {
  type Clip,
  type Edit,
  type EditAction,
  editReducer,
  initialHistory,
  normalizeEdit,
  presentEdit,
} from "./reelEdit"
import {
  dragOverlayEdge,
  dragOverlayMove,
  layOut,
  overlayLanes,
  xAtReelTime,
} from "./timeline"

const text = (
  id: string,
  start: number,
  end: number,
  extra: Partial<Overlay> = {},
): Overlay => ({
  id,
  type: "text",
  start,
  end,
  x: 0.5,
  y: 0.5,
  size: 0.06,
  text: "Wow",
  ...extra,
})
const clip = (
  id: string,
  start: number,
  end: number,
  slow_mo = false,
): Clip => ({
  id,
  start,
  end,
  slow_mo,
  rally_id: null,
})
/** A 10 s reel: clips of 4 s and 3 s, then 1.5 s in slow-mo (3 s). */
const CLIPS = [clip("a", 0, 4), clip("b", 10, 13), clip("c", 20, 21.5, true)]
const edit = (...overlays: Overlay[]): Edit => ({
  ...normalizeEdit(undefined),
  segments: CLIPS,
  overlays,
})
const run = (start: Edit, ...actions: EditAction[]) =>
  actions.reduce(editReducer, initialHistory(start))

describe("the export's geometry", () => {
  test("a box is centred, then kept inside the margins", () => {
    // 100 px box in a 1000 px frame with 30 px margins
    expect(placeBox(500, 100, 1000, 30)).toBe(450)
    expect(placeBox(40, 100, 1000, 30)).toBe(30)
    expect(placeBox(990, 100, 1000, 30)).toBe(870)
    // Wider than the room: centred in the frame
    expect(placeBox(100, 960, 1000, 30)).toBe(20)
  })

  test("a drag stores a centre the export won't have to move", () => {
    expect(clampCentre(0.01, 100, 1000, 30)).toBeCloseTo(0.08)
    expect(clampCentre(0.5, 100, 1000, 30)).toBe(0.5)
    expect(clampCentre(0.99, 100, 1000, 30)).toBeCloseTo(0.92)
  })
})

describe("text", () => {
  test("one line, trimmed, at most 80 characters", () => {
    expect(cleanText("  Rally\n of   the night ")).toBe("Rally of the night")
    expect([...cleanText("ลูก".repeat(40))].length).toBe(80)
  })

  test("Thai breaks between words, Latin after spaces", () => {
    expect(linePieces("Rally 5 สุดยอด!")).toEqual(["Rally ", "5 ", "สุด", "ยอด!"])
  })

  test("runs: Thai apart from the rest; spaces and punctuation stay in their run", () => {
    expect(fontRuns("Rally 5 สุดยอด! ok")).toEqual([
      { text: "Rally 5 ", thai: false },
      { text: "สุดยอด! ", thai: true },
      { text: "ok", thai: false },
    ])
  })
})

describe("time", () => {
  test("on screen in [start, end)", () => {
    const o = text("o1", 2, 5)
    expect(isActive(o, 1.9)).toBe(false)
    expect(isActive(o, 2)).toBe(true)
    // A seek that lands a hair early still counts
    expect(isActive(o, 1.99)).toBe(true)
    expect(isActive(o, 4.9)).toBe(true)
    expect(isActive(o, 5)).toBe(false)
  })

  test("a new text: 3 s from the playhead's 0.1 s step, centred, default size", () => {
    expect(
      newTextOverlay({ id: "o1", at: 2.47, length: 10, text: " Hi " }),
    ).toEqual(text("o1", 2.4, 5.4, { text: "Hi" }))
    // Near the end: shorter, but never under 0.3 s
    expect(
      newTextOverlay({ id: "o1", at: 9, length: 10, text: "x" }),
    ).toMatchObject({
      start: 9,
      end: 10,
    })
    expect(
      newTextOverlay({ id: "o1", at: 9.95, length: 10, text: "x" }),
    ).toMatchObject({ start: 9.7, end: 10 })
  })

  test("spans: 0.1 s grid, inside the reel, at least 0.3 s", () => {
    expect(fitOverlaySpan({ start: 1.04, end: 2.96 }, 10)).toEqual({
      start: 1,
      end: 3,
    })
    expect(fitOverlaySpan({ start: 9.9, end: 12 }, 10)).toEqual({
      start: 9.7,
      end: 10,
    })
    expect(fitOverlaySpan({ start: 2, end: 2.1 }, 10, "end")).toEqual({
      start: 1.8,
      end: 2.1,
    })
  })

  test("kept inside the reel like the backend: cut at the end, or the last 0.3 s", () => {
    const overlays = [text("o1", 1, 4), text("o2", 5, 9), text("o3", 8.5, 9)]
    expect(clampToReel(overlays, 6)).toEqual([
      text("o1", 1, 4),
      text("o2", 5, 6),
      text("o3", 5.7, 6),
    ])
    // Nothing to change: the same list
    expect(clampToReel(overlays, 10)).toBe(overlays)
    // No length yet (no clips): left alone
    expect(clampToReel(overlays, 0)).toBe(overlays)
  })

  test("cut: both parts at least 0.3 s, the second gets the new id", () => {
    expect(canCutOverlay(text("o1", 2, 5), 2.2)).toBe(false)
    expect(canCutOverlay(text("o1", 2, 5), 4.8)).toBe(false)
    expect(cutOverlay([text("o1", 2, 5)], "o1", 3.04, "o2")).toEqual([
      text("o1", 2, 3),
      text("o2", 3, 5),
    ])
  })

  test("new ids never repeat", () => {
    expect(newOverlayId([text("o2", 0, 1)])).toBe("o3")
    expect(newOverlayId([text("o1", 0, 1), text("o3", 0, 1)])).toBe("o4")
  })
})

describe("looks", () => {
  test("position inside the frame, size 0.03-0.15, an empty text changes nothing", () => {
    expect(cleanPatch({ x: 1.2, y: -0.1, size: 0.5 })).toEqual({
      x: 1,
      y: 0,
      size: 0.15,
    })
    expect(cleanPatch({ size: 0.001 })).toEqual({ size: 0.03 })
    expect(cleanPatch({ text: "   " })).toEqual({})
  })
})

describe("the reducer: one undo step each", () => {
  test("add, move, resize, edit text, change times, cut, delete, and undo of each", () => {
    let history = run(edit(), {
      type: "add-overlay",
      overlay: text("o1", 1, 4),
    })
    const steps: [EditAction, Partial<Overlay>[]][] = [
      [
        { type: "update-overlay", id: "o1", patch: { x: 0.3, y: 0.8 } },
        [{ x: 0.3, y: 0.8 }],
      ],
      [
        { type: "update-overlay", id: "o1", patch: { size: 0.1 } },
        [{ size: 0.1 }],
      ],
      [
        { type: "update-overlay", id: "o1", patch: { text: "Smash!" } },
        [{ text: "Smash!" }],
      ],
      [
        { type: "set-overlay-times", id: "o1", span: { start: 2, end: 6 } },
        [{ start: 2, end: 6 }],
      ],
      [
        { type: "cut-overlay", id: "o1", at: 3, newId: "o2" },
        [
          { id: "o1", end: 3 },
          { id: "o2", start: 3 },
        ],
      ],
      [{ type: "delete-overlay", id: "o2" }, [{ id: "o1" }]],
    ]
    for (const [action, expected] of steps) {
      const before = presentEdit(history)
      history = editReducer(history, action)
      expect(presentEdit(history).overlays).toMatchObject(expected)
      const undone = editReducer(history, { type: "undo" })
      expect(presentEdit(undone)).toEqual(before)
    }
    // Back to before the add
    for (let i = 0; i < steps.length + 1; i++)
      history = editReducer(history, { type: "undo" })
    expect(presentEdit(history).overlays).toEqual([])
  })

  test("at most 20 overlays", () => {
    const full = edit(
      ...Array.from({ length: MAX_OVERLAYS }, (_, i) =>
        text(`o${i + 1}`, 0, 1),
      ),
    )
    const history = run(full, { type: "add-overlay", overlay: text("x", 0, 1) })
    expect(presentEdit(history).overlays).toHaveLength(MAX_OVERLAYS)
    // Nothing changed: no undo step
    expect(history.entries).toHaveLength(1)
  })

  test("a change that shortens the reel cuts overlays past its new end", () => {
    const history = run(edit(text("o1", 8, 10)), { type: "delete", id: "c" })
    // 7 s left: cut at 7 s, moved to the last 0.3 s
    expect(presentEdit(history).overlays).toEqual([text("o1", 6.7, 7)])
    // Undo brings it back as it was
    expect(
      presentEdit(editReducer(history, { type: "undo" })).overlays,
    ).toEqual([text("o1", 8, 10)])
  })

  test("times are fitted: a start dragged past the end gives at least 0.3 s", () => {
    const history = run(edit(text("o1", 1, 4)), {
      type: "set-overlay-times",
      id: "o1",
      span: { start: 3.95, end: 4 },
    })
    expect(presentEdit(history).overlays[0]).toMatchObject({
      start: 3.7,
      end: 4,
    })
  })
})

describe("the overlay track", () => {
  // 6 px per second, 2 px between clips: a 0-24, b 26-44, c 46-64
  const { placed } = layOut(CLIPS)

  test("overlapping overlays go in separate lanes", () => {
    expect(
      overlayLanes([
        { start: 0, end: 3 },
        { start: 2, end: 5 },
        { start: 3, end: 4 },
        { start: 4.5, end: 6 },
      ]),
    ).toEqual([0, 1, 0, 0])
  })

  test("an edge drag snaps to where clips meet, else to 0.1 s; at least 0.3 s", () => {
    const origin = { start: 1, end: 3 }
    // 3 s is at 18 px; +6 px → 24 px = the end of clip a (4 s): snapped
    expect(
      dragOverlayEdge({ placed, origin, edge: "end", dx: 4, length: 10 }),
    ).toEqual({ span: { start: 1, end: 4 }, snapped: 4 })
    // Far from a boundary: 0.1 s steps (zoomed in, 60 px per second)
    const zoomed = layOut(CLIPS, 60).placed
    expect(
      dragOverlayEdge({
        placed: zoomed,
        origin,
        edge: "end",
        dx: 20,
        length: 10,
      }).span,
    ).toEqual({ start: 1, end: 3.3 })
    // The start can't pass end - 0.3
    expect(
      dragOverlayEdge({
        placed: zoomed,
        origin,
        edge: "start",
        dx: 500,
        length: 10,
      }).span,
    ).toEqual({ start: 2.7, end: 3 })
    // Inside the reel
    expect(
      dragOverlayEdge({ placed, origin, edge: "end", dx: 999, length: 10 }).span
        .end,
    ).toBe(10)
  })

  test("moving keeps the length, snaps either end, stays inside the reel", () => {
    const zoomed = layOut(CLIPS, 60).placed
    const origin = { start: 1, end: 2 }
    // +1 s with nothing near: 2-3
    expect(
      dragOverlayMove({ placed: zoomed, origin, dx: 60, length: 10 }).span,
    ).toEqual({ start: 2, end: 3 })
    // Its end near where a and b meet (4 s): snapped there
    const nearB = xAtReelTime(zoomed, 4) - xAtReelTime(zoomed, 2) - 5
    expect(
      dragOverlayMove({ placed: zoomed, origin, dx: nearB, length: 10 }),
    ).toEqual({ span: { start: 3, end: 4 }, snapped: 4 })
    // Past the end: the last second of the reel
    expect(
      dragOverlayMove({ placed: zoomed, origin, dx: 9999, length: 10 }).span,
    ).toEqual({ start: 9, end: 10 })
  })
})
