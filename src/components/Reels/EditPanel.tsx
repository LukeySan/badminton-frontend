import { ChevronsLeftRight } from "lucide-react"
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { RallyPublic } from "@/client"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Edit } from "./reelEdit"
import {
  layOut,
  type PlacedItem,
  reelTimeAtX,
  type TimelineItem,
  xAtReelTime,
} from "./timeline"

type Span = { start: number; end: number }

const VIEW_HINT = {
  cut: "Breaks are hidden, not deleted. Tap a gap to bring it back.",
  full: "Everything stays. Picked rallies are highlighted.",
} as const

/**
 * Edit mode: what the reel keeps (Rallies only | Full video) and the timeline.
 * Everything that changes the reel is a callback that goes through the reducer.
 */
export function EditPanel({
  view,
  items,
  reelTime,
  selectedClip,
  onSetView,
  onScrubStart,
  onScrub,
  onSelectClip,
  onRestore,
  onHide,
  onPick,
  children,
}: {
  view: Edit["view"]
  items: TimelineItem[]
  /** Where the playhead is, in reel time. */
  reelTime: number
  selectedClip: number | undefined
  onSetView: (view: Edit["view"]) => void
  /** The user started moving the timeline (pause playback). */
  onScrubStart: () => void
  /** The user moved the timeline to this reel time. */
  onScrub: (reelTime: number) => void
  onSelectClip: (clipIndex: number) => void
  onRestore: (region: Span) => void
  onHide: (region: Span) => void
  onPick: (rally: RallyPublic) => void
  /** Below the timeline (selection info, tools). */
  children?: ReactNode
}) {
  return (
    <section aria-label="Edit" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-2 md:px-0">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(next) => next && onSetView(next as Edit["view"])}
          aria-label="What the reel keeps"
          className="shrink-0 rounded-[10px] border p-0.5"
        >
          {(
            [
              ["cut", "Rallies only"],
              ["full", "Full video"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={cn(
                // 44 px tall touch target around the 28 px button
                "relative h-7 whitespace-nowrap rounded-[8px] px-2.5 text-xs after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
                "data-[state=off]:bg-transparent data-[state=off]:font-bold data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground",
                "data-[state=on]:bg-chapter data-[state=on]:font-extrabold data-[state=on]:text-chapter-foreground data-[state=on]:hover:bg-chapter data-[state=on]:hover:text-chapter-foreground",
              )}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p
          className="min-w-0 flex-1 text-[11px] leading-[1.3] text-muted-foreground"
          aria-live="polite"
        >
          {VIEW_HINT[view]}
        </p>
      </div>

      <Timeline
        view={view}
        items={items}
        reelTime={reelTime}
        selectedClip={selectedClip}
        onScrubStart={onScrubStart}
        onScrub={onScrub}
        onSelectClip={onSelectClip}
        onRestore={onRestore}
        onHide={onHide}
        onPick={onPick}
      />
      {children}
    </section>
  )
}

/** After the last scroll event of a gesture (incl. momentum), give control back. */
const SCRUB_IDLE_MS = 180
/** A mouse drag shorter than this is a click. */
const DRAG_THRESHOLD = 4

/**
 * TikTok-style timeline: a fixed playhead in the middle, the reel moving under it.
 * Native horizontal scroll (touch and trackpad get momentum for free), plus
 * click-and-drag with a mouse. While playing, the timeline follows the video;
 * while the user moves it, the video follows the timeline.
 */
function Timeline({
  view,
  items,
  reelTime,
  selectedClip,
  onScrubStart,
  onScrub,
  onSelectClip,
  onRestore,
  onHide,
  onPick,
}: {
  view: Edit["view"]
  items: TimelineItem[]
  reelTime: number
  selectedClip: number | undefined
  onScrubStart: () => void
  onScrub: (reelTime: number) => void
  onSelectClip: (clipIndex: number) => void
  onRestore: (region: Span) => void
  onHide: (region: Span) => void
  onPick: (rally: RallyPublic) => void
}) {
  const { placed, width } = useMemo(() => layOut(items), [items])
  const scrollRef = useRef<HTMLElement>(null)
  const [half, setHalf] = useState(0)

  // The playhead is the middle of the view, so the track starts and ends half a
  // view in: then scrollLeft = the x under the playhead.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setHalf(Math.round(element.clientWidth / 2))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // --- Who moves whom ---------------------------------------------------------------
  const userActive = useRef(false)
  const idleTimer = useRef<number | undefined>(undefined)
  const ourScrollLeft = useRef<number | null>(null)
  const frame = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(idleTimer.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    },
    [],
  )

  // Follow playback (and edits that move things around), unless the user is moving it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: half changes the scroll range
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || userActive.current) return
    element.scrollLeft = xAtReelTime(placed, reelTime)
    ourScrollLeft.current = element.scrollLeft
  }, [placed, reelTime, half])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    // Our own scroll from following playback: nothing to do.
    if (
      ourScrollLeft.current !== null &&
      Math.abs(element.scrollLeft - ourScrollLeft.current) < 1
    )
      return
    ourScrollLeft.current = null
    if (!userActive.current) {
      userActive.current = true
      onScrubStart()
    }
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      userActive.current = false
    }, SCRUB_IDLE_MS)
    // At most one seek per frame.
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      onScrub(reelTimeAtX(placed, element.scrollLeft))
    })
  }

  // Mouse: click and drag to move the timeline (touch and trackpads scroll natively).
  const drag = useRef<{ x: number; scrollLeft: number; moved: boolean } | null>(
    null,
  )
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return
    drag.current = {
      x: event.clientX,
      scrollLeft: scrollRef.current!.scrollLeft,
      moved: false,
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    if (!current.moved) {
      current.moved = true
      // Capture only once it's a drag, so plain clicks still reach the items.
      scrollRef.current!.setPointerCapture(event.pointerId)
    }
    scrollRef.current!.scrollLeft = current.scrollLeft - dx
  }
  const endDrag = () => {
    // Keep `moved` until the click that ends the drag has been swallowed.
    window.setTimeout(() => {
      drag.current = null
    })
  }

  const step = view === "full" ? 60 : 10
  const ticks = useMemo(() => rulerTicks(placed, step), [placed, step])

  return (
    // As tall as its tracks (ruler + clip track); the playhead spans them.
    <div className="relative h-[96px] shrink-0">
      <section
        ref={scrollRef}
        aria-label="Reel timeline"
        data-testid="timeline"
        // Focusable: arrow keys scroll it (and so move the playhead).
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region
        tabIndex={0}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          if (drag.current?.moved) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        className="absolute inset-0 select-none overflow-x-auto overflow-y-hidden overscroll-x-contain outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="relative pt-1"
          style={{ width: width + 2 * half, paddingLeft: half }}
        >
          {/* Ruler (reel time) */}
          <div className="relative h-5" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.t}
                className="absolute top-0.5 h-3.5 whitespace-nowrap border-l pl-[3px] text-[10px] leading-3.5 text-muted-foreground/70 tabular-nums"
                style={{ left: tick.x }}
              >
                {formatDuration(tick.t)}
              </span>
            ))}
          </div>

          {/* Clip track */}
          <div className="relative mt-1 h-[60px]" style={{ width }}>
            {placed.map((item) => (
              <TrackItem
                key={item.key}
                item={item}
                view={view}
                selected={
                  item.kind === "clip" && item.clipIndex === selectedClip
                }
                onSelectClip={onSelectClip}
                onRestore={onRestore}
                onHide={onHide}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      </section>

      {/* The fixed playhead */}
      <div
        aria-hidden="true"
        data-testid="playhead"
        className="pointer-events-none absolute top-0 bottom-2 left-1/2 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground ring-1 ring-background"
      />
    </div>
  )
}

/** Ruler ticks every `step` seconds of reel time, inside items with a length. */
function rulerTicks(placed: PlacedItem[], step: number) {
  const ticks: { t: number; x: number }[] = []
  for (const item of placed) {
    const length = item.reel.end - item.reel.start
    if (length <= 0) continue
    for (
      let t = Math.ceil(item.reel.start / step) * step;
      t < item.reel.end;
      t += step
    ) {
      ticks.push({ t, x: item.x + ((t - item.reel.start) / length) * item.w })
    }
  }
  return ticks
}

const base =
  "absolute top-0 h-[60px] overflow-hidden rounded-[8px] p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

function TrackItem({
  item,
  view,
  selected,
  onSelectClip,
  onRestore,
  onHide,
  onPick,
}: {
  item: PlacedItem
  view: Edit["view"]
  selected: boolean
  onSelectClip: (clipIndex: number) => void
  onRestore: (region: Span) => void
  onHide: (region: Span) => void
  onPick: (rally: RallyPublic) => void
}) {
  const position = { left: item.x, width: item.w }
  const length = item.src.end - item.src.start
  const label = (text: string, className?: string) =>
    item.w >= 34 && (
      <span
        className={cn(
          "absolute top-[5px] left-1.5 whitespace-nowrap text-[10px]",
          className,
        )}
      >
        {text}
      </span>
    )

  switch (item.kind) {
    case "clip": {
      const number = item.segment?.number
      const reelLength = item.reel.end - item.reel.start
      return (
        <button
          type="button"
          data-testid="clip"
          aria-label={`${number ? `Rally ${number}` : "Clip"}, ${formatDuration(reelLength)}`}
          aria-pressed={selected}
          onClick={() => onSelectClip(item.clipIndex)}
          className={cn(
            base,
            "bg-court",
            selected && "ring-2 ring-highlight ring-inset",
          )}
          style={{
            ...position,
            backgroundImage:
              "repeating-linear-gradient(90deg, color-mix(in oklab, var(--chapter) 35%, transparent) 0 1px, transparent 1px 30px)",
          }}
        >
          {item.w >= 34 && (
            <span className="absolute top-[5px] left-1.5 whitespace-nowrap rounded-[5px] bg-court-ink/85 px-[5px] py-px text-[10px] font-extrabold text-court-foreground tabular-nums">
              {number ? `R${number} · ` : ""}
              {formatDuration(reelLength)}
            </span>
          )}
        </button>
      )
    }
    case "gap":
      return (
        <button
          type="button"
          data-testid="gap"
          aria-label={`Show ${formatDuration(length)} of cut footage`}
          onClick={() => onRestore(item.region)}
          className={cn(
            base,
            "flex flex-col items-center justify-center gap-0.5 bg-sheet text-[10px] font-extrabold text-muted-foreground ring-1 ring-muted-foreground/60 ring-inset tabular-nums",
          )}
          style={position}
        >
          <ChevronsLeftRight className="size-3.5" strokeWidth={2.4} />
          {formatDuration(length)}
        </button>
      )
    case "break": {
      const stripes = {
        ...position,
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--card) 0 6px, var(--secondary) 6px 12px)",
      }
      const text = label(
        `Break ${formatDuration(length)}`,
        "font-bold text-muted-foreground",
      )
      // Full video: breaks are just footage. Rallies only: a restored break can be
      // hidden again with a tap.
      return view === "cut" ? (
        <button
          type="button"
          data-testid="break"
          aria-label={`Break, ${formatDuration(length)}, tap to cut again`}
          onClick={() => onHide(item.region)}
          className={base}
          style={stripes}
        >
          {text}
        </button>
      ) : (
        <div data-testid="break" className={base} style={stripes}>
          {text}
        </div>
      )
    }
    case "unpicked":
      return (
        <button
          type="button"
          data-testid="unpicked"
          aria-label={`Rally ${item.segment.number}, not in the reel. Tap to add`}
          onClick={() => onPick(item.segment.rally)}
          className={cn(
            base,
            "bg-court/45 text-foreground ring-1 ring-chapter/50 ring-inset",
          )}
          style={position}
        >
          {label(`R${item.segment.number}`, "font-extrabold")}
          {item.w >= 34 && (
            <span className="absolute bottom-[5px] left-1.5 whitespace-nowrap text-[10px] font-bold">
              + add
            </span>
          )}
        </button>
      )
  }
}
