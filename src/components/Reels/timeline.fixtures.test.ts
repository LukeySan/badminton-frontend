// The preview must play what the export renders. The backend's export snapshot
// (badminton-backend/app/export_snapshot.py) and this timeline are both tested
// against the same fixtures: badminton-backend/shared/reel-segments, copied to
// tests/fixtures/reel-segments (`bun run sync-fixtures`). Run: `bun run test:unit`.

/// <reference types="bun" />
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { RallyPublic, ReelEdit } from "@/client"
import { toSegments } from "@/components/Player/rallies"
import { normalizeEdit, rallyWindows } from "./reelEdit"
import { buildTimeline, type TimelineItem } from "./timeline"

const DIR = join(import.meta.dir, "../../../tests/fixtures/reel-segments")

type Played = {
  kind: "piece" | "gap"
  start: number
  end: number
  slow_mo: boolean
}

type Fixture = {
  description: string
  duration: number
  rallies: { id: number; start: number; end: number }[]
  edit: ReelEdit
  expected: { segments: Played[]; duration: number }
}

const round3 = (t: number) => Math.round(t * 1000) / 1000

/** The stretches of the source the Rallies-only preview plays, in order. Breaks and
 *  unpicked rallies next to each other are one restored stretch, like the export's. */
function playedStretches(items: TimelineItem[]): Played[] {
  const out: Played[] = []
  for (const item of items) {
    if (item.reel.end - item.reel.start <= 0) continue
    const kind = item.kind === "piece" ? "piece" : "gap"
    const slow_mo = item.kind === "piece" ? item.piece.slow_mo : false
    const last = out[out.length - 1]
    if (
      kind === "gap" &&
      last?.kind === "gap" &&
      Math.abs(last.end - item.src.start) < 1e-6
    ) {
      last.end = round3(item.src.end)
      continue
    }
    out.push({
      kind,
      start: round3(item.src.start),
      end: round3(item.src.end),
      slow_mo,
    })
  }
  return out
}

function load(name: string): Fixture {
  return JSON.parse(readFileSync(join(DIR, name), "utf-8")) as Fixture
}

function rallies(fixture: Fixture): RallyPublic[] {
  return [...fixture.rallies]
    .sort((a, b) => a.start - b.start)
    .map((r, i) => ({
      id: r.id,
      number: i + 1,
      start: r.start,
      end: r.end,
      duration: round3(r.end - r.start),
      confidence: null,
      is_maybe: false,
    }))
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()

describe("Rallies-only preview plays what the export renders", () => {
  test("fixtures are there", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const name = file.replace(/\.json$/, "")
    test(name, () => {
      const fixture = load(file)
      // The export is always the Rallies-only result, whatever view is open
      const edit = { ...normalizeEdit(fixture.edit), view: "cut" as const }
      const list = rallies(fixture)
      const windows = rallyWindows(list, edit, fixture.duration)
      const items = buildTimeline(
        edit,
        toSegments(list, fixture.duration),
        windows,
        fixture.duration,
      )
      expect(playedStretches(items)).toEqual(fixture.expected.segments)
    })
  }
})
