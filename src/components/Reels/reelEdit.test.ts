/// <reference types="bun" />
// Edit list v5: a flat list of clips in playback order. The operations the editor's
// reducer runs, and undo / redo. Run: `bun run test:unit`.

import { describe, expect, test } from "bun:test"
import type { RallyPublic } from "@/client"
import {
  type Clip,
  canCut,
  cutClip,
  type Edit,
  editReducer,
  fitBounds,
  initialHistory,
  insertClip,
  moveClip,
  newClipIds,
  normalizeEdit,
  pickMany,
  pickRally,
  presentEdit,
  rallyOver,
  reelLength,
  relabel,
  setCaption,
  setClipBounds,
  unpickRally,
} from "./reelEdit"

const DURATION = 60
const rally = (id: number, start: number, end: number): RallyPublic => ({
  id,
  number: id,
  start,
  end,
  duration: end - start,
  confidence: null,
  is_maybe: false,
})
const R1 = rally(1, 10, 20)
const R2 = rally(2, 30, 40)
const R3 = rally(3, 45.04, 50)

const clip = (
  id: string,
  start: number,
  end: number,
  rally_id: number | null = null,
  slow_mo = false,
): Clip => ({ id, start, end, slow_mo, rally_id })
const reel = (...segments: Clip[]): Edit => ({
  ...normalizeEdit(undefined),
  segments,
})
const spans = (edit: Edit) =>
  edit.segments.map((c) => [c.id, c.start, c.end] as const)

describe("normalizeEdit", () => {
  test("fills in the defaults", () => {
    expect(normalizeEdit(undefined)).toEqual({
      version: 5,
      format: "16:9",
      segments: [],
      captions: [],
    })
    expect(
      normalizeEdit({ segments: [{ id: "s1", start: 1, end: 2 }] }).segments,
    ).toEqual([clip("s1", 1, 2)])
  })
})

describe("picking rallies", () => {
  test("a rally gets 1 s on each side, clamped to the video, on the 0.1 s grid", () => {
    expect(spans(pickRally(reel(), R1, DURATION, "a"))).toEqual([["a", 9, 21]])
    // 45.04 - 1 = 44.04 → 44.0; at the video's start / end it stops there
    expect(spans(pickRally(reel(), R3, DURATION, "a"))).toEqual([["a", 44, 51]])
    expect(
      spans(pickRally(reel(), rally(4, 0.4, 59.5), DURATION, "a")),
    ).toEqual([["a", 0, 60]])
  })

  test("goes in match order relative to the clips there", () => {
    const start = reel(clip("x", 50, 55), clip("y", 2, 5))
    // Before the first clip (in list order) that starts after it
    expect(spans(pickRally(start, R2, DURATION, "a")).map((s) => s[0])).toEqual(
      ["a", "x", "y"],
    )
    const sorted = reel(clip("x", 2, 5), clip("y", 50, 55))
    expect(
      spans(pickRally(sorted, R2, DURATION, "a")).map((s) => s[0]),
    ).toEqual(["x", "a", "y"])
  })

  test("a picked rally isn't added twice; unpicking removes all its clips", () => {
    const once = pickRally(reel(), R1, DURATION)
    expect(pickRally(once, R1, DURATION)).toBe(once)
    const cut = cutClip(once, once.segments[0].id, 15, "b")
    expect(cut.segments).toHaveLength(2)
    expect(unpickRally(cut, R1.id).segments).toEqual([])
  })

  test("pick many: new ids, match order", () => {
    const edit = pickMany(reel(), [R2, R1], DURATION)
    expect(spans(edit)).toEqual([
      ["c2", 9, 21],
      ["c1", 29, 41],
    ])
  })
})

describe("editing clips", () => {
  test("cut at the playhead: two parts, both at least 0.3 s", () => {
    const edit = reel(clip("a", 10, 20, 1, true))
    expect(canCut(edit.segments[0], 10.2)).toBe(false)
    expect(canCut(edit.segments[0], 10.3)).toBe(true)
    expect(canCut(edit.segments[0], 19.75)).toBe(false)
    const cut = cutClip(edit, "a", 14.04, "b")
    expect(cut.segments).toEqual([
      clip("a", 10, 14, 1, true),
      clip("b", 14, 20, 1, true),
    ])
    expect(cutClip(edit, "a", 10.1, "b")).toBe(edit)
  })

  test("edges go anywhere in the video, at least 0.3 s, on the 0.1 s grid", () => {
    const edit = reel(clip("a", 10, 20))
    expect(
      spans(setClipBounds(edit, "a", { start: 3.26, end: 20 }, 60)),
    ).toEqual([["a", 3.3, 20]])
    // Past the end of the video: stops there
    expect(
      spans(setClipBounds(edit, "a", { start: 10, end: 75 }, 60.04)),
    ).toEqual([["a", 10, 60]])
    // Dragged past the other edge: the moved one stops 0.3 s from it
    expect(
      spans(setClipBounds(edit, "a", { start: 19.9, end: 20 }, 60)),
    ).toEqual([["a", 19.7, 20]])
    expect(spans(setClipBounds(edit, "a", { start: 10, end: 9 }, 60))).toEqual([
      ["a", 10, 10.3],
    ])
  })

  test("fitBounds keeps clips inside a short video", () => {
    expect(fitBounds({ start: 59.9, end: 60 }, 60)).toEqual({
      start: 59.7,
      end: 60,
    })
    expect(fitBounds({ start: -2, end: 0.1 }, 60, "end")).toEqual({
      start: 0,
      end: 0.3,
    })
  })

  test("move: the clip's index afterwards", () => {
    const edit = reel(clip("a", 0, 1), clip("b", 1, 2), clip("c", 2, 3))
    expect(moveClip(edit, "a", 2).segments.map((c) => c.id)).toEqual([
      "b",
      "c",
      "a",
    ])
    expect(moveClip(edit, "c", 0).segments.map((c) => c.id)).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  test("insert (Add footage) and its label", () => {
    const edit = reel(clip("a", 0, 1), clip("b", 1, 2))
    expect(
      insertClip(edit, clip("x", 25, 31), 1).segments.map((c) => c.id),
    ).toEqual(["a", "x", "b"])
    expect(rallyOver({ start: 18, end: 31 }, [R1, R2])).toBe(R1.id)
    expect(rallyOver({ start: 21, end: 29 }, [R1, R2])).toBeNull()
  })

  test("length: slow-mo plays twice as long", () => {
    expect(reelLength(reel(clip("a", 0, 2), clip("b", 5, 6, null, true)))).toBe(
      4,
    )
  })

  test("captions are in source time and replace what's under the clip", () => {
    const edit = setCaption(
      reel(clip("a", 10, 20)),
      { start: 10, end: 20 },
      "Wow",
    )
    expect(edit.captions).toEqual([{ start: 10, end: 20, text: "Wow" }])
    expect(setCaption(edit, { start: 12, end: 14 }, "").captions).toEqual([])
  })

  test("new ids never repeat one in the reel", () => {
    expect(newClipIds(reel(clip("c2", 0, 1)), 2)).toEqual(["c3", "c4"])
    expect(newClipIds(reel(clip("s1", 0, 1), clip("c3", 1, 2)), 2)).toEqual([
      "c4",
      "c5",
    ])
  })

  test("relabel after a fix: a gone rally's clips get what they show, or none", () => {
    const merged = rally(9, 10, 40)
    const edit = reel(
      clip("a", 9, 21, 1),
      clip("b", 29, 41, 2),
      clip("x", 55, 58),
    )
    expect(relabel(edit, [merged]).segments.map((c) => c.rally_id)).toEqual([
      9,
      9,
      null,
    ])
    expect(relabel(edit, []).segments.map((c) => c.rally_id)).toEqual([
      null,
      null,
      null,
    ])
  })
})

describe("history", () => {
  test("every change is one undo step; a no-op isn't one", () => {
    let history = initialHistory(reel())
    history = editReducer(history, {
      type: "pick-rally",
      rally: R1,
      duration: DURATION,
    })
    history = editReducer(history, {
      type: "set-bounds",
      id: "c1",
      span: { start: 9, end: 23.4 },
      duration: DURATION,
    })
    history = editReducer(history, {
      type: "insert",
      clip: clip("x", 25, 30),
      index: 1,
    })
    history = editReducer(history, { type: "move", id: "x", to: 0 })
    // Moving it where it is: nothing to undo
    const same = editReducer(history, { type: "move", id: "x", to: 0 })
    expect(same).toBe(history)
    expect(spans(presentEdit(history))).toEqual([
      ["x", 25, 30],
      ["c1", 9, 23.4],
    ])
    history = editReducer(history, { type: "undo" })
    expect(spans(presentEdit(history)).map((s) => s[0])).toEqual(["c1", "x"])
    history = editReducer(history, { type: "undo" })
    history = editReducer(history, { type: "undo" })
    expect(spans(presentEdit(history))).toEqual([["c1", 9, 21]])
    history = editReducer(history, { type: "redo" })
    expect(spans(presentEdit(history))).toEqual([["c1", 9, 23.4]])
  })

  test("undoing a rally fix remaps the labels before it", () => {
    let history = initialHistory(reel(clip("a", 9, 21, 1)))
    const fix = {
      kind: "delete" as const,
      before: [1] as [number],
      after: [] as [],
      from: { start: 10, end: 20 },
    }
    history = editReducer(history, {
      type: "fix",
      fix,
      edit: relabel(presentEdit(history), []),
    })
    expect(presentEdit(history).segments[0].rally_id).toBeNull()
    // The reverse endpoint added it back as rally 7
    history = editReducer(history, { type: "undo-fix", ids: [7] })
    expect(presentEdit(history).segments[0].rally_id).toBe(7)
  })
})
