import {
  Check,
  ChevronRight,
  EllipsisVertical,
  Merge,
  MoveHorizontal,
  SquareSplitHorizontal,
  Trash2,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import type { RallyPublic } from "@/client"
import type { Segment } from "@/components/Player/rallies"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CourtThumbnail } from "@/components/Videos/CourtThumbnail"
import { formatDuration, formatPlayhead } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FrameThumb, type Thumbnails } from "./thumbnails"

type Filter = "all" | "picked" | "longest"

/** A rally fix from the ⋮ menu (the editor opens a dialog or calls the backend). */
export type FixKind = "edit" | "split" | "merge" | "delete"

/**
 * Highlights mode: every rally of the match with a check to put it in the reel or
 * take it out. Tap a row to watch it; ⋮ fixes the rally itself (everywhere, not just
 * this reel). The bar at the bottom sums up the reel and leads to the timeline.
 */
export function HighlightsPanel({
  segments,
  isPicked,
  keptOf,
  currentNumber,
  pickedCount,
  reelSeconds,
  thumbs,
  fixBusy,
  onToggle,
  onJump,
  onFix,
  onAddMissed,
  onEditReel,
}: {
  /** Every rally, numbered in match order (as in the player). */
  segments: Segment[]
  isPicked: (rally: RallyPublic) => boolean
  /** Seconds kept in this reel, when the rally was cut here (undefined: not cut). */
  keptOf: (rally: RallyPublic) => number | undefined
  currentNumber: number | undefined
  pickedCount: number
  reelSeconds: number
  thumbs: Thumbnails | undefined
  /** A rally fix is running: no other one until it's done. */
  fixBusy: boolean
  onToggle: (rally: RallyPublic, pick: boolean) => void
  onJump: (segment: Segment) => void
  onFix: (kind: FixKind, segment: Segment) => void
  onAddMissed: () => void
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
  const last = segments[segments.length - 1]

  return (
    <section aria-label="Highlights" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-4 pb-2 md:px-0">
        <ToggleGroup
          type="single"
          spacing={1}
          value={filter}
          onValueChange={(next) => next && setFilter(next as Filter)}
          aria-label="Show rallies"
          className="justify-start"
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
        <button
          type="button"
          onClick={onAddMissed}
          disabled={fixBusy}
          aria-label="Add a missed rally here"
          className="relative ml-auto h-[30px] shrink-0 whitespace-nowrap rounded-full border border-dashed border-muted-foreground px-2.5 text-xs font-bold outline-none after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          + Missed rally
        </button>
      </div>

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
            <li key={segment.rally.id} data-number={segment.number}>
              <RallyRow
                segment={segment}
                picked={isPicked(segment.rally)}
                kept={keptOf(segment.rally)}
                current={segment.number === currentNumber}
                longest={segment === longest}
                isLast={segment === last}
                thumbs={thumbs}
                fixBusy={fixBusy}
                onToggle={onToggle}
                onJump={onJump}
                onFix={onFix}
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
  kept,
  current,
  longest,
  isLast,
  thumbs,
  fixBusy,
  onToggle,
  onJump,
  onFix,
}: {
  segment: Segment
  picked: boolean
  kept: number | undefined
  current: boolean
  longest: boolean
  isLast: boolean
  thumbs: Thumbnails | undefined
  fixBusy: boolean
  onToggle: (rally: RallyPublic, pick: boolean) => void
  onJump: (segment: Segment) => void
  onFix: (kind: FixKind, segment: Segment) => void
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
        className="flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CourtThumbnail
          duration={rally.duration}
          size="sm"
          frame={
            thumbs && (
              <FrameThumb
                thumbs={thumbs}
                // A moment into the rally: the serve, not the walk back
                t={Math.min(rally.end, rally.start + 1)}
                width={72}
                height={40}
              />
            )
          }
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-bold">Rally {number}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            at {formatDuration(rally.start)}
            {kept !== undefined && (
              <>
                {" · "}
                <span data-testid="kept" className="text-success-text">
                  {formatPlayhead(kept)} kept
                </span>
              </>
            )}
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
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Fix rally ${number}`}
            disabled={fixBusy}
            className="flex h-[52px] w-10 shrink-0 items-center justify-center rounded-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <EllipsisVertical className="size-[18px]" strokeWidth={2.2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[min(18rem,calc(100vw-2rem))] rounded-[14px] border-0 bg-card p-1.5 shadow-lg"
        >
          <FixItem
            icon={<MoveHorizontal />}
            onSelect={() => onFix("edit", segment)}
          >
            Fix start and end
          </FixItem>
          <FixItem
            icon={<SquareSplitHorizontal />}
            onSelect={() => onFix("split", segment)}
          >
            Split into two rallies
          </FixItem>
          <FixItem
            icon={<Merge />}
            disabled={isLast}
            onSelect={() => onFix("merge", segment)}
          >
            Merge with next rally
          </FixItem>
          <FixItem
            icon={<Trash2 />}
            variant="destructive"
            onSelect={() => onFix("delete", segment)}
          >
            Not a rally, delete it
          </FixItem>
          <p className="mx-3 mt-1 mb-1.5 text-[11px] leading-[1.35] text-muted-foreground">
            Fixes change this rally everywhere, including the player's chapters.
            To shorten it just for this reel, use Cut in Edit mode.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function FixItem({
  icon,
  children,
  variant,
  disabled,
  onSelect,
}: {
  icon: ReactNode
  children: string
  variant?: "destructive"
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      variant={variant}
      disabled={disabled}
      onSelect={onSelect}
      className="h-11 gap-2.5 rounded-[10px] px-3 text-[13px] font-bold [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
      {children}
    </DropdownMenuItem>
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
