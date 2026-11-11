import { Check, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { RallyPublic } from "@/client"
import type { Segment } from "@/components/Player/rallies"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CourtThumbnail } from "@/components/Videos/CourtThumbnail"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

type Filter = "all" | "picked" | "longest"

/**
 * Highlights mode: every rally of the match with a check to put it in the reel or
 * take it out. Tap a row to watch it. The bar at the bottom sums up the reel and
 * leads to the timeline.
 */
export function HighlightsPanel({
  segments,
  isPicked,
  currentNumber,
  pickedCount,
  reelSeconds,
  onToggle,
  onJump,
  onEditReel,
}: {
  /** Every rally, numbered in match order (as in the player). */
  segments: Segment[]
  isPicked: (rally: RallyPublic) => boolean
  currentNumber: number | undefined
  pickedCount: number
  reelSeconds: number
  onToggle: (rally: RallyPublic, pick: boolean) => void
  onJump: (segment: Segment) => void
  onEditReel: () => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const longest = useMemo(
    () =>
      segments.reduce<Segment | undefined>(
        (best, s) =>
          !best || s.rally.duration > best.rally.duration ? s : best,
        undefined,
      ),
    [segments],
  )
  const rows = useMemo(() => {
    if (filter === "picked") return segments.filter((s) => isPicked(s.rally))
    if (filter === "longest")
      return [...segments].sort((a, b) => b.rally.duration - a.rally.duration)
    return segments
  }, [filter, segments, isPicked])

  // Keep the playing rally in view (scrolls the list, never the page).
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const list = listRef.current
    if (!list || currentNumber === undefined) return
    const row = list.querySelector<HTMLElement>(
      `[data-number="${currentNumber}"]`,
    )
    if (!row || list.scrollHeight <= list.clientHeight) return
    const above = row.offsetTop < list.scrollTop
    const below =
      row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight
    if (above || below)
      list.scrollTo({
        top: row.offsetTop - list.clientHeight / 3,
        behavior: "smooth",
      })
  }, [currentNumber])

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: `All ${segments.length}` },
    { value: "picked", label: `Picked ${pickedCount}` },
    { value: "longest", label: "Longest" },
  ]

  return (
    <section aria-label="Highlights" className="flex min-h-0 flex-1 flex-col">
      <ToggleGroup
        type="single"
        spacing={1}
        value={filter}
        onValueChange={(next) => next && setFilter(next as Filter)}
        aria-label="Show rallies"
        className="justify-start px-4 pb-2 md:px-0"
      >
        {filters.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className={cn(
              // 44 px tall touch target around the 30 px pill
              "relative h-[30px] rounded-full px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
              "data-[state=off]:border data-[state=off]:bg-transparent data-[state=off]:font-semibold data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground",
              "data-[state=on]:bg-foreground data-[state=on]:font-extrabold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
            )}
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {rows.length === 0 ? (
        <p className="flex-1 px-4 py-6 text-center text-[13px] text-muted-foreground">
          No rallies picked yet. Tap the circle next to a rally to add it.
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-label="Rallies"
          className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 md:px-0"
        >
          {rows.map((segment) => (
            <li key={segment.number} data-number={segment.number}>
              <RallyRow
                segment={segment}
                picked={isPicked(segment.rally)}
                current={segment.number === currentNumber}
                longest={segment === longest}
                onToggle={onToggle}
                onJump={onJump}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Sticky on desktop (the page scrolls there); phones: the end of the screen */}
      <div className="sticky bottom-0 flex shrink-0 items-center gap-3 border-t border-track bg-background px-4 pt-2.5 pb-[max(1.375rem,env(safe-area-inset-bottom))] md:px-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-extrabold">{pickedCount} picked</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(reelSeconds)} reel
          </span>
        </div>
        <Button
          size="lg"
          onClick={onEditReel}
          className="gap-1.5 bg-foreground px-[18px] font-extrabold text-background hover:bg-foreground/90"
        >
          Edit reel
          <ChevronRight className="size-4" strokeWidth={2.6} />
        </Button>
      </div>
    </section>
  )
}

function RallyRow({
  segment,
  picked,
  current,
  longest,
  onToggle,
  onJump,
}: {
  segment: Segment
  picked: boolean
  current: boolean
  longest: boolean
  onToggle: (rally: RallyPublic, pick: boolean) => void
  onJump: (segment: Segment) => void
}) {
  const { rally, number } = segment
  return (
    <div
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex items-center rounded-[14px]",
        // Current: pink outline AND a surface (pink is never the only difference)
        current && "bg-card ring-2 ring-highlight ring-inset",
      )}
    >
      {/* A real checkbox (keyboard, screen readers), drawn as the round check */}
      <label className="group flex h-[52px] w-11 shrink-0 cursor-pointer items-center justify-center rounded-[14px]">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={picked}
          onChange={() => onToggle(rally, !picked)}
          aria-label={`Rally ${number} in the reel`}
        />
        {picked ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-chapter text-chapter-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            <Check className="size-3.5" strokeWidth={3.2} />
          </span>
        ) : (
          <span className="size-[22px] rounded-full border-2 border-muted-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
        )}
      </label>
      <button
        type="button"
        onClick={() => onJump(segment)}
        aria-label={`Play rally ${number}, at ${formatDuration(rally.start)}, ${formatDuration(rally.duration)} long`}
        className="flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CourtThumbnail duration={rally.duration} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-bold">Rally {number}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            at {formatDuration(rally.start)}
          </span>
        </span>
        {current ? (
          <Tag className="bg-highlight/16 text-highlight-text-strong">
            Playing
          </Tag>
        ) : (
          longest && (
            <Tag className="bg-success-soft text-success-text">Longest</Tag>
          )
        )}
      </button>
    </div>
  )
}

function Tag({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={cn(
        "flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-extrabold",
        className,
      )}
    >
      {children}
    </span>
  )
}
