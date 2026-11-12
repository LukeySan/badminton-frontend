import { RalliesService, type RallyChange, type ReelImpact } from "@/client"
import { formatTenths } from "@/lib/format"

// Rally fixes (Highlights mode's ⋮ menu): changes to the match's rallies on the server,
// so they show everywhere (player chapters, every reel). Each fix records the rally
// ids on both sides, so the editor's undo can call the reverse endpoint and redo the
// forward one again. Those calls make new rallies (new ids): `before` / `after` are
// updated each time, and the edit history is remapped to them.

type Span = { start: number; end: number }

export type RallyFix =
  /** Start / end changed. Same id on both sides. */
  | { kind: "edit"; before: [number]; after: [number]; from: Span; to: Span }
  /** A rally the detector missed. */
  | { kind: "add"; before: []; after: [number]; to: Span }
  /** Not a rally. */
  | { kind: "delete"; before: [number]; after: []; from: Span }
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
  /** Reels the server adjusted, merged over all the calls (latest version each). */
  reels: ReelImpact[]
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
      return { ids: [id], change, reels: change.reels }
    }
    case "add": {
      const change = await one(RalliesService.addRally({ path, body: fix.to }))
      return { ids: [change.added[0].id], change, reels: change.reels }
    }
    case "delete": {
      const change = await one(
        RalliesService.deleteRally({
          path: { ...path, rally_id: fix.before[0] },
        }),
      )
      return { ids: [], change, reels: change.reels }
    }
    case "split": {
      const [id] = fix.before
      const change = await one(
        RalliesService.splitRally({
          path: { ...path, rally_id: id },
          body: { at: fix.at },
        }),
      )
      return { ids: [id, change.added[0].id], change, reels: change.reels }
    }
    case "merge": {
      const change = await one(
        RalliesService.mergeRallies({ path, body: { rally_ids: fix.before } }),
      )
      return { ids: [change.added[0].id], change, reels: change.reels }
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
      return { ids: [id], change, reels: change.reels }
    }
    case "add": {
      const change = await one(
        RalliesService.deleteRally({
          path: { ...path, rally_id: fix.after[0] },
        }),
      )
      return { ids: [], change, reels: change.reels }
    }
    case "delete": {
      const change = await one(
        RalliesService.addRally({ path, body: fix.from }),
      )
      return { ids: [change.added[0].id], change, reels: change.reels }
    }
    case "split": {
      const change = await one(
        RalliesService.mergeRallies({ path, body: { rally_ids: fix.after } }),
      )
      return { ids: [change.added[0].id], change, reels: change.reels }
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
        return { ids: [id, second], change: split, reels: split.reels }
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
        reels: mergeImpacts(split.reels, change.reels),
      }
    }
  }
}

function mergeImpacts(a: ReelImpact[], b: ReelImpact[]): ReelImpact[] {
  const byId = new Map(a.map((r) => [r.id, r]))
  for (const r of b) {
    const old = byId.get(r.id)
    byId.set(
      r.id,
      old
        ? {
            ...r,
            clips_removed: old.clips_removed + r.clips_removed,
            pieces_trimmed: old.pieces_trimmed + r.pieces_trimmed,
            pieces_removed: old.pieces_removed + r.pieces_removed,
          }
        : r,
    )
  }
  return [...byId.values()]
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

/** "This highlight: 1 part trimmed · 2 other highlights updated" */
export function describeImpact(reels: ReelImpact[], reelId: string): string {
  const parts: string[] = []
  const mine = reels.find((r) => r.id === reelId)
  if (mine) {
    const changes = [
      plural(mine.clips_removed, "clip removed", "clips removed"),
      plural(mine.pieces_trimmed, "part trimmed", "parts trimmed"),
      plural(mine.pieces_removed, "part removed", "parts removed"),
    ].filter(Boolean)
    if (changes.length) parts.push(`This highlight: ${changes.join(", ")}`)
  }
  const others = reels.filter((r) => r.id !== reelId).length
  if (others > 0)
    parts.push(
      `${others} other ${others === 1 ? "highlight" : "highlights"} updated`,
    )
  parts.push("The player's chapters are updated too.")
  return parts.join(" · ")
}

const plural = (n: number, one: string, many: string) =>
  n === 0 ? "" : `${n} ${n === 1 ? one : many}`
