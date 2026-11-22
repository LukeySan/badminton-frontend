/// <reference types="bun" />
// Restored breaks (restored_anchors) and deleted footage (clip cuts) in "Rallies
// only", through the timeline the editor shows. Run: `bun run test:unit`.

import { describe, expect, test } from "bun:test"
import type { RallyPublic } from "@/client"
import { toSegments } from "@/components/Player/rallies"
import {
  cutPiece,
  deletePiece,
  type Edit,
  hiddenRegions,
  hideRegion,
  normalizeEdit,
  rallyWindows,
  restoreHidden,
  setLead,
  stretches,
} from "./reelEdit"
import { buildTimeline, type TimelineItem } from "./timeline"

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
const RALLIES = [rally(1, 10, 20), rally(2, 30, 40)]

type ClipSpec = {
  pieces: [number, number, boolean?][]
  cuts?: [number, number][]
}

function edit(clips: ClipSpec[], anchors: number[] = []): Edit {
  return normalizeEdit({
    clips: clips.map((clip, i) => ({
      rally_id: i + 1,
      pieces: clip.pieces.map(([start, end, slow_mo]) => ({
        start,
        end,
        slow_mo: slow_mo ?? false,
      })),
      cuts: (clip.cuts ?? []).map(([start, end]) => ({ start, end })),
    })),
    restored_anchors: anchors,
  })
}

const timeline = (e: Edit) =>
  buildTimeline(
    e,
    toSegments(RALLIES, DURATION),
    rallyWindows(RALLIES, e, DURATION),
    DURATION,
  )

/** What plays, as [start, end, kind] in reel order (restored footage merged). */
function played(items: TimelineItem[]): [number, number, string][] {
  const out: [number, number, string][] = []
  for (const item of items) {
    if (item.reel.end <= item.reel.start) continue
    const kind =
      item.kind === "piece" ? (item.piece.slow_mo ? "slow" : "piece") : "gap"
    const last = out[out.length - 1]
    if (kind === "gap" && last?.[2] === "gap" && last[1] === item.src.start)
      last[1] = item.src.end
    else out.push([item.src.start, item.src.end, kind])
  }
  return out
}

const gapMarkers = (items: TimelineItem[]) =>
  items.filter((i) => i.kind === "gap") as Extract<
    TimelineItem,
    { kind: "gap" }
  >[]

const NOTHING = { regions: [], cuts: [] }

describe("restored breaks are anchors", () => {
  test("hidden stretches are what no piece covers", () => {
    expect(
      hiddenRegions(edit([{ pieces: [[9, 21]] }, { pieces: [[29, 41]] }]), 60),
    ).toEqual([
      { start: 0, end: 9 },
      { start: 21, end: 29 },
      { start: 41, end: 60 },
    ])
  })

  test("tapping a gap marker restores it with an anchor in the middle", () => {
    const before = edit([{ pieces: [[9, 21]] }, { pieces: [[29, 41]] }])
    const between = gapMarkers(timeline(before)).find((g) => g.src.start === 21)
    const after = restoreHidden(before, between?.hidden ?? NOTHING)
    expect(after.restored_anchors).toEqual([25])
    expect(played(timeline(after))).toEqual([
      [9, 21, "piece"],
      [21, 29, "gap"],
      [29, 41, "piece"],
    ])
  })

  test("tapping a restored break hides it again", () => {
    const restored = edit([{ pieces: [[9, 21]] }, { pieces: [[29, 41]] }], [25])
    const item = timeline(restored).find((i) => i.kind === "break")
    const region = item?.kind === "break" ? item.region : { start: 0, end: 0 }
    const hidden = hideRegion(restored, region)
    expect(hidden.restored_anchors).toEqual([])
    expect(played(timeline(hidden))).toEqual([
      [9, 21, "piece"],
      [29, 41, "piece"],
    ])
  })

  test("a restored break follows its pieces", () => {
    // Pieces shrink (lead 1 s -> 0.5 s): the restored stretch grows with them
    const shrunk = edit(
      [{ pieces: [[9.5, 20.5]] }, { pieces: [[29.5, 40.5]] }],
      [25],
    )
    expect(played(timeline(shrunk))).toContainEqual([20.5, 29.5, "gap"])
    // A piece grows over the anchor: nothing restored any more
    const covered = edit([{ pieces: [[9, 26]] }, { pieces: [[29, 41]] }], [25])
    expect(played(timeline(covered)).some(([, , kind]) => kind === "gap")).toBe(
      false,
    )
  })
})

describe("deleted footage is a cut", () => {
  test("deleting a piece records it; splitting doesn't", () => {
    const start = edit([{ pieces: [[9, 21]] }, { pieces: [[29, 41]] }])
    const split = cutPiece(start, { clipIndex: 0, pieceIndex: 0 }, 18)
    expect(split.clips[0].cuts).toEqual([])
    const deleted = deletePiece(split, { clipIndex: 0, pieceIndex: 1 })
    expect(deleted.clips[0].pieces).toEqual([
      { start: 9, end: 18, slow_mo: false },
    ])
    expect(deleted.clips[0].cuts).toEqual([{ start: 18, end: 21 }])
    // Deleting the last piece takes the rally out of the reel, its cuts with it
    const gone = deletePiece(deleted, { clipIndex: 0, pieceIndex: 0 })
    expect(gone.clips.map((c) => c.rally_id)).toEqual([2])
  })

  test("a cut is a wall: the restored break stops at it", () => {
    const e = edit(
      [{ pieces: [[9, 21]] }, { pieces: [[29, 41]], cuts: [[26, 29]] }],
      [25],
    )
    expect(stretches(e, DURATION)).toContainEqual({ start: 21, end: 26 })
    expect(played(timeline(e))).toEqual([
      [9, 21, "piece"],
      [21, 26, "gap"],
      [29, 41, "piece"],
    ])
  })

  test("a gap marker over a cut puts it back into its clip", () => {
    // Rally 1's last 3 s (18-21) were deleted; the marker covers them and the break
    const before = edit([
      {
        pieces: [
          [9, 14],
          [14, 18, true],
        ],
        cuts: [[18, 21]],
      },
      { pieces: [[29, 41]] },
    ])
    const between = gapMarkers(timeline(before)).find((g) => g.src.start === 18)
    expect(between?.hidden.cuts).toEqual([
      { clipIndex: 0, span: { start: 18, end: 21 } },
    ])
    expect(between?.hidden.regions).toEqual([{ start: 21, end: 29 }])
    const after = restoreHidden(before, between?.hidden ?? NOTHING)
    expect(after.clips[0].pieces[after.clips[0].pieces.length - 1]).toEqual({
      start: 14,
      end: 21,
      slow_mo: true,
    })
    expect(after.clips[0].cuts).toEqual([])
    expect(after.restored_anchors).toEqual([25])
    expect(played(timeline(after))).toEqual([
      [9, 14, "piece"],
      [14, 21, "slow"],
      [21, 29, "gap"],
      [29, 41, "piece"],
    ])
  })

  test("a deleted lead stays deleted when the lead grows", () => {
    const e = edit([{ pieces: [[10, 21]], cuts: [[9, 10]] }])
    const grown = setLead(e, { lead_in: 2, lead_out: 1 }, [RALLIES[0]], 60)
    expect(grown.clips[0].cuts).toEqual([{ start: 8, end: 10 }])
    expect(grown.clips[0].pieces).toEqual([
      { start: 10, end: 21, slow_mo: false },
    ])
  })
})
