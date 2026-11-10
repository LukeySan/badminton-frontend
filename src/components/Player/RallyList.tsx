import { type ReactNode, useEffect, useMemo, useRef } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Segment } from "./rallies"

export type RallySort = "time" | "length"

/** Minimum-length filter (DESIGN.md: All / 5s+ / 10s+). */
export const MIN_LENGTH_OPTIONS = [0, 5, 10]

const SORTS: { value: RallySort; label: string }[] = [
  { value: "time", label: "Time" },
  { value: "length", label: "Longest" },
]

// 44 px touch target around the 32 px pills
const target =
  "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"

/**
 * Rally list (DESIGN.md "Rally list"): a bottom sheet on phones, a side panel on
 * wide screens. `children` (e.g. a warning) goes above the rows.
 */
export function RallyList({
  segments,
  totalCount,
  longest,
  currentNumber,
  sort,
  onSortChange,
  minLength,
  onMinLengthChange,
  onSelect,
  className,
  children,
}: {
  /** Already filtered by minimum length, in time order. */
  segments: Segment[]
  totalCount: number
  /** Longest rally overall: bar widths don't jump when the filter changes. */
  longest: number
  currentNumber: number | undefined
  sort: RallySort
  onSortChange: (sort: RallySort) => void
  minLength: number
  onMinLengthChange: (seconds: number) => void
  onSelect: (segment: Segment) => void
  className?: string
  children?: ReactNode
}) {
  const listRef = useRef<HTMLUListElement>(null)

  const sorted = useMemo(
    () =>
      sort === "length"
        ? [...segments].sort((a, b) => b.rally.duration - a.rally.duration)
        : segments,
    [segments, sort],
  )

  // Keep the playing rally in view when the list scrolls by itself (the sheet on
  // phones, the side panel on desktop). Never scrolls the page.
  useEffect(() => {
    const list = listRef.current
    if (!list || currentNumber === undefined) return
    if (list.scrollHeight <= list.clientHeight) return
    const row = list.querySelector<HTMLElement>(
      `[data-number="${currentNumber}"]`,
    )
    if (!row) return
    const above = row.offsetTop < list.scrollTop
    const below =
      row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight
    if (above || below) {
      list.scrollTo({
        top: row.offsetTop - list.clientHeight / 3,
        behavior: "smooth",
      })
    }
  }, [currentNumber])

  return (
    <section
      aria-label="Rallies"
      className={cn(
        "flex min-h-0 flex-col rounded-t-[22px] bg-sheet shadow-sheet",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <ToggleGroup
          type="single"
          spacing={1}
          value={sort}
          onValueChange={(next) => next && onSortChange(next as RallySort)}
          aria-label="Sort rallies"
        >
          {SORTS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={cn(
                target,
                "h-8 rounded-[10px] px-3 text-[13px]",
                "data-[state=off]:bg-secondary data-[state=off]:font-semibold data-[state=off]:text-subtle-foreground data-[state=off]:hover:text-foreground",
                "data-[state=on]:bg-foreground data-[state=on]:font-extrabold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          spacing={1}
          value={String(minLength)}
          onValueChange={(next) => next && onMinLengthChange(Number(next))}
          aria-label="Minimum rally length"
        >
          {MIN_LENGTH_OPTIONS.map((seconds) => (
            <ToggleGroupItem
              key={seconds}
              value={String(seconds)}
              aria-label={
                seconds === 0 ? "Any length" : `${seconds} seconds or longer`
              }
              className={cn(
                target,
                "h-8 rounded-[10px] border-[1.5px] px-2.5 text-xs",
                "data-[state=off]:bg-transparent data-[state=off]:font-semibold data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground",
                // Selected: green outline + soft fill (white on the light sheet)
                "data-[state=on]:border-primary data-[state=on]:bg-sheet data-[state=on]:font-extrabold data-[state=on]:text-success-text data-[state=on]:hover:bg-sheet data-[state=on]:hover:text-success-text dark:data-[state=on]:bg-success-soft dark:data-[state=on]:hover:bg-success-soft",
              )}
            >
              {seconds === 0 ? "All" : `${seconds}s+`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {children}

      <h2 className="px-4 pb-1.5 text-xs font-bold text-muted-foreground">
        {segments.length === totalCount
          ? `${totalCount} rallies`
          : `${segments.length} of ${totalCount} rallies`}
      </h2>

      {sorted.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          No rallies of {minLength} s or longer.
        </p>
      ) : (
        <ul
          ref={listRef}
          className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {sorted.map((segment) => (
            <li key={segment.number} data-number={segment.number}>
              <RallyRow
                segment={segment}
                isCurrent={segment.number === currentNumber}
                longest={longest}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RallyRow({
  segment,
  isCurrent,
  longest,
  onSelect,
}: {
  segment: Segment
  isCurrent: boolean
  longest: number
  onSelect: (segment: Segment) => void
}) {
  const { rally } = segment
  return (
    <button
      type="button"
      onClick={() => onSelect(segment)}
      aria-current={isCurrent ? "true" : undefined}
      aria-label={`Rally ${segment.number}, at ${formatDuration(rally.start)}, ${rally.duration.toFixed(1)} seconds`}
      className={cn(
        "grid h-[50px] w-full grid-cols-[44px_52px_minmax(0,1fr)_52px] items-center gap-2 rounded-md border-[1.5px] px-2.5 text-left text-sm tabular-nums transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // Current: pink fill AND outline (pink is never the only difference)
        isCurrent
          ? "border-highlight bg-highlight-soft"
          : "border-transparent hover:bg-secondary/60",
      )}
    >
      <span
        className={cn(
          isCurrent
            ? "font-extrabold text-highlight-text"
            : "font-bold text-muted-foreground",
        )}
      >
        #{segment.number}
      </span>
      <span className={cn(isCurrent && "font-bold")}>
        {formatDuration(rally.start)}
      </span>
      {/* Length bar: width = this rally ÷ the longest rally */}
      <span
        aria-hidden="true"
        className={cn(
          "relative h-2 overflow-hidden rounded-[4px]",
          isCurrent ? "bg-highlight/20" : "bg-secondary",
        )}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-[4px]",
            isCurrent ? "bg-highlight" : "bg-chapter",
          )}
          style={{
            width: `${(rally.duration / Math.max(longest, 0.1)) * 100}%`,
          }}
        />
      </span>
      <span
        className={cn(
          "text-right",
          isCurrent ? "font-extrabold" : "font-semibold text-subtle-foreground",
        )}
      >
        {rally.duration.toFixed(1)}s
      </span>
    </button>
  )
}
