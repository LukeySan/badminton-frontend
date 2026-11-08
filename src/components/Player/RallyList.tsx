import { useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { rallyTime, type Segment } from "./rallies"

export type RallySort = "time" | "length"

export const MIN_LENGTH_OPTIONS = [0, 3, 5, 8, 12]

export function RallyList({
  segments,
  totalCount,
  videoDuration,
  currentNumber,
  sort,
  onSortChange,
  minLength,
  onMinLengthChange,
  onSelect,
  className,
}: {
  /** Already filtered by minimum length, in time order. */
  segments: Segment[]
  totalCount: number
  videoDuration: number
  currentNumber: number | undefined
  sort: RallySort
  onSortChange: (sort: RallySort) => void
  minLength: number
  onMinLengthChange: (seconds: number) => void
  onSelect: (segment: Segment) => void
  className?: string
}) {
  const listRef = useRef<HTMLUListElement>(null)

  const sorted = useMemo(
    () =>
      sort === "length"
        ? [...segments].sort((a, b) => b.rally.duration - a.rally.duration)
        : segments,
    [segments, sort],
  )
  const longest = Math.max(1, ...segments.map((s) => s.rally.duration))
  const playTime = rallyTime(segments)

  // Keep the playing rally visible, but only when the list scrolls by itself (side
  // panel on wide screens). On phones the page scrolls, and jumping the page while
  // someone watches would be annoying.
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
      className={cn("flex min-h-0 flex-col rounded-lg border", className)}
    >
      <div className="flex flex-col gap-3 border-b p-3">
        <div>
          <h2 className="font-semibold">
            {segments.length === totalCount
              ? `${totalCount} rallies`
              : `${segments.length} of ${totalCount} rallies`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatDuration(playTime)} of play in{" "}
            {formatDuration(videoDuration)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup aria-label="Sort rallies">
            {(["time", "length"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={sort === value ? "default" : "outline"}
                aria-pressed={sort === value}
                onClick={() => onSortChange(value)}
              >
                {value === "time" ? "By time" : "Longest"}
              </Button>
            ))}
          </ButtonGroup>
          <Select
            value={String(minLength)}
            onValueChange={(value) => onMinLengthChange(Number(value))}
          >
            <SelectTrigger
              size="sm"
              className="w-auto"
              aria-label="Minimum rally length"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIN_LENGTH_OPTIONS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {seconds === 0 ? "Any length" : `${seconds} s or longer`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No rallies of {minLength} s or longer.
        </p>
      ) : (
        <ul
          ref={listRef}
          className="relative min-h-0 flex-1 divide-y overflow-y-auto"
        >
          {sorted.map((segment) => {
            const isCurrent = segment.number === currentNumber
            return (
              <li key={segment.number} data-number={segment.number}>
                <button
                  type="button"
                  onClick={() => onSelect(segment)}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-label={`Rally ${segment.number}, at ${formatDuration(segment.rally.start)}, ${segment.rally.duration.toFixed(1)} seconds`}
                  className={cn(
                    "flex w-full items-center gap-3 border-l-2 border-transparent px-3 py-2.5 text-left text-sm tabular-nums transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                    isCurrent && "border-primary bg-primary/10",
                  )}
                >
                  <span
                    className={cn(
                      "w-9 shrink-0 font-medium text-muted-foreground",
                      isCurrent && "text-primary",
                    )}
                  >
                    #{segment.number}
                  </span>
                  <span className="w-14 shrink-0">
                    {formatDuration(segment.rally.start)}
                  </span>
                  {/* Length as a bar too, so long rallies stand out at a glance */}
                  <span className="flex-1" aria-hidden="true">
                    <span
                      className="block h-1.5 rounded-full bg-primary/50"
                      style={{
                        width: `${(segment.rally.duration / longest) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-muted-foreground">
                    {segment.rally.duration.toFixed(1)} s
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
