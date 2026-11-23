import { RalliesService, type RallyChange } from "@/client"
import { formatTenths } from "@/lib/format"

// Rally fixes (Highlights mode's ⋮ menu): changes to the match's rallies on the server,
// so they show everywhere (the player's chapters, the rally list). They don't change
// the reel: its clips are times in the video (edit list v5), only a clip's rally
// label can go out of date (see relabel in reelEdit.ts). Each fix records the rally
// ids on both sides, so the editor's undo can call the reverse endpoint and redo the
// forward one again. Those calls make new rallies (new ids): `before` / `after` are
// updated each time, and the edit history is remapped to them.

type Span = { start: number; end: number }

export type RallyFix =
  /** Start / end changed. Same id on both sides. */
  | { kind: "edit"; before: [number]; after: [number]; from: Span; to: Span }
  /** A rally the detector missed. */
  | { kind: "add"; before: []; after: [number]; to: Span }
  /** Not a rally. `maybe`: it was a "maybe", so undo brings it back as one. */
  | { kind: "delete"; before: [number]; after: []; from: Span; maybe?: boolean }
  /** "Keep": a maybe is a rally (same id on both sides). */
  | { kind: "confirm"; before: [number]; after: [number] }
  /** One rally became two at `at` (the first keeps the id). */
  | {
      kind: "split"
      before: [number]
      after: [number, number]
      from: Span
      at: number
    }
  /** Two neighbours became one (a new id). */
  | {
      kind: "merge"
      before: [number, number]
      after: [number]
      first: Span
      second: Span
    }

/** A fix about to be made: its `after` ids come from the server. */
export type NewFix = RallyFix extends infer F
  ? F extends RallyFix
    ? Omit<F, "after">
    : never
  : never

export type FixResult = {
  /** The rallies on the side we moved to (after for forward, before for reverse). */
  ids: number[]
  /** The last change: its `rallies` is the whole list now. */
  change: RallyChange
}

const one = async (call: Promise<{ data: RallyChange }>) => (await call).data

/** Make the fix (or make it again, for redo), from its `before` side. */
export async function applyFix(
  videoId: string,
  fix: NewFix | RallyFix,
): Promise<FixResult> {
  const path = { id: videoId }
  switch (fix.kind) {
    case "edit": {
      const [id] = fix.before
      const change = await one(
        RalliesService.editRally({
          path: { ...path, rally_id: id },
          body: fix.to,
        }),
      )
      return { ids: [id], change }
    }
    case "add": {
      const change = await one(RalliesService.addRally({ path, body: fix.to }))
      return { ids: [change.added[0].id], change }
    }
    case "delete": {
      const change = await one(
        RalliesService.deleteRally({
          path: { ...path, rally_id: fix.before[0] },
        }),
      )
      return { ids: [], change }
    }
    case "confirm": {
      const [id] = fix.before
      const change = await one(
        RalliesService.confirmRally({ path: { ...path, rally_id: id } }),
      )
      return { ids: [id], change }
    }
    case "split": {
      const [id] = fix.before
      const change = await one(
        RalliesService.splitRally({
          path: { ...path, rally_id: id },
          body: { at: fix.at },
        }),
      )
      return { ids: [id, change.added[0].id], change }
    }
    case "merge": {
      const change = await one(
        RalliesService.mergeRallies({ path, body: { rally_ids: fix.before } }),
      )
      return { ids: [change.added[0].id], change }
    }
  }
}

/** Undo the fix, from its `after` side. Returns the ids on the before side. */
export async function reverseFix(
  videoId: string,
  fix: RallyFix,
): Promise<FixResult> {
  const path = { id: videoId }
  switch (fix.kind) {
    case "edit": {
      const [id] = fix.after
      const change = await one(
        RalliesService.editRally({
          path: { ...path, rally_id: id },
          body: fix.from,
        }),
      )
      return { ids: [id], change }
    }
    case "add": {
      const change = await one(
        RalliesService.deleteRally({
          path: { ...path, rally_id: fix.after[0] },
        }),
      )
      return { ids: [], change }
    }
    case "delete": {
      const added = await one(RalliesService.addRally({ path, body: fix.from }))
      const id = added.added[0].id
      if (!fix.maybe) return { ids: [id], change: added }
      // Added rallies are sure ones: make it a maybe again, as it was
      const change = await one(
        RalliesService.unconfirmRally({ path: { ...path, rally_id: id } }),
      )
      return {
        ids: [id],
        change,
      }
    }
    case "confirm": {
      const [id] = fix.after
      const change = await one(
        RalliesService.unconfirmRally({ path: { ...path, rally_id: id } }),
      )
      return { ids: [id], change }
    }
    case "split": {
      const change = await one(
        RalliesService.mergeRallies({ path, body: { rally_ids: fix.after } }),
      )
      return { ids: [change.added[0].id], change }
    }
    case "merge": {
      // Split the merged rally where the first one ended, then put the second one's
      // start back (the gap between them was part of neither).
      const [id] = fix.after
      const split = await one(
        RalliesService.splitRally({
          path: { ...path, rally_id: id },
          body: { at: fix.first.end },
        }),
      )
      const second = split.added[0].id
      if (fix.second.start - fix.first.end < 1e-6) {
        return { ids: [id, second], change: split }
      }
      const change = await one(
        RalliesService.editRally({
          path: { ...path, rally_id: second },
          body: fix.second,
        }),
      )
      return {
        ids: [id, second],
        change,
      }
    }
  }
}

/** "Rally 5 split into 5 and 6": what a fix did, with the numbers after it. */
export function describeFix(fix: RallyFix, change: RallyChange): string {
  const number = (id: number | undefined) =>
    change.rallies.find((r) => r.id === id)?.number
  switch (fix.kind) {
    case "edit":
      return `Rally ${number(fix.after[0])} is now ${formatTenths(fix.to.start)}–${formatTenths(fix.to.end)}`
    case "add":
      return `Rally ${number(fix.after[0])} added at ${formatTenths(fix.to.start)}`
    case "delete": {
      // Gone from the list: its number was the count of rallies before it, plus one
      const n = change.rallies.filter((r) => r.end <= fix.from.start).length + 1
      return `Rally ${n} deleted`
    }
    case "confirm":
      return `Rally ${number(fix.after[0])} kept`
    case "split": {
      const first = number(fix.after[0])
      return `Rally ${first} split into ${first} and ${number(fix.after[1])}`
    }
    case "merge": {
      const n = number(fix.after[0])
      return `Rallies ${n} and ${(n ?? 0) + 1} merged into rally ${n}`
    }
  }
}

/**
 * The toast's second line. A fix never changes the reel; deleting a rally that has
 * clips in it leaves them playing (they show the same footage), so say so.
 */
export function describeImpact(fix: RallyFix, clipsOfDeleted: number): string {
  if (fix.kind === "delete" && clipsOfDeleted > 0)
    return `Its ${clipsOfDeleted === 1 ? "clip stays" : "clips stay"} in your reel. The chapters are updated too.`
  return "The chapters are updated too."
}
