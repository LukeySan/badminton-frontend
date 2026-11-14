import { ChevronsLeftRight } from "lucide-react"
import {
  type MouseEvent,
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
import { formatDuration, formatPlayhead } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LeadSetting } from "./LeadSetting"
import {
  captionOf,
  type Edit,
  type Hidden,
  type PieceRef,
  type Span,
} from "./reelEdit"
import { type Thumbnails, ThumbStrip } from "./thumbnails"
import {
  layOut,
  type PlacedItem,
  reelTimeAtX,
  type TimelineItem,
  xAtReelTime,
} from "./timeline"

const VIEW_HINT = {
  cut: "Breaks and cut parts are hidden, not deleted. Tap a gap to bring it back.",
  full: "Everything stays. Picked rallies are highlighted.",
} as const

export type TimelineCallbacks = {
  /** The user started moving the timeline (pause playback). */
  onScrubStart: () => void
  /** The user moved the timeline to this reel time. */
  onScrub: (reelTime: number) => void
  /** A piece was tapped, at this moment of the video. */
  onSelectPiece: (piece: PieceRef, sourceTime: number) => void
  onRestoreHidden: (hidden: Hidden) => void
  onHide: (region: Span) => void
  onRestoreCut: (clipIndex: number, span: Span) => void
  onPick: (rally: RallyPublic) => void
}

/**
 * Edit mode: what the reel keeps (Rallies only | Full video), the lead around each
 * rally, and the timeline. Everything that changes the reel is a callback that goes
 * through the reducer.
 */
export function EditPanel({
  edit,
  items,
  reelTime,
  selected,
  thumbs,
  onSetView,
  onSetLead,
  timeline,
  children,
}: {
  edit: Edit
  items: TimelineItem[]
  /** Where the playhead is, in reel time. */
  reelTime: number
  selected: PieceRef | undefined
  thumbs: Thumbnails | undefined
  onSetView: (view: Edit["view"]) => void
  onSetLead: (lead: { lead_in: number; lead_out: number }) => void
  timeline: TimelineCallbacks
  /** Below the timeline (selection hint, tools). */
  children?: ReactNode
}) {
  const view = edit.view
  return (
    <section aria-label="Edit" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2.5 px-4 md:px-0">
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
        <LeadSetting
          leadIn={edit.lead_in}
          leadOut={edit.lead_out}
          onChange={onSetLead}
        />
      </div>
      <p
        className="shrink-0 px-4 pb-2 text-[11px] leading-[1.3] text-muted-foreground md:px-0"
        aria-live="polite"
      >
        {VIEW_HINT[view]}
      </p>

      <Timeline
        edit={edit}
        items={items}
        reelTime={reelTime}
        selected={selected}
        thumbs={thumbs}
        {...timeline}
      />
      {children}
    </section>
  )
}

/** After the last scroll event of a gesture (incl. momentum), give control back. */
const SCRUB_IDLE_MS = 180
/** A mouse drag shorter than this is a click. */
const DRAG_THRESHOLD = 4
/** Frames are drawn this far beyond each side of the view (px). */
const THUMB_MARGIN = 360

/**
 * TikTok-style timeline: a fixed playhead in the middle, the reel moving under it.
 * Native horizontal scroll (touch and trackpad get momentum for free), plus
 * click-and-drag with a mouse. While playing, the timeline follows the video;
 * while the user moves it, the video follows the timeline.
 */
function Timeline({
  edit,
  items,
  reelTime,
  selected,
  thumbs,
  onScrubStart,
  onScrub,
  onSelectPiece,
  onRestoreHidden,
  onHide,
  onRestoreCut,
  onPick,
}: {
  edit: Edit
  items: TimelineItem[]
  reelTime: number
  selected: PieceRef | undefined
  thumbs: Thumbnails | undefined
} & TimelineCallbacks) {
  const { placed, width } = useMemo(() => layOut(items), [items])
  const scrollRef = useRef<HTMLElement>(null)
  const [half, setHalf] = useState(0)
  const view = edit.view

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

  const playheadX = xAtReelTime(placed, reelTime)
  // Follow playback (and edits that move things around), unless the user is moving it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: half changes the scroll range
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || userActive.current) return
    element.scrollLeft = playheadX
    ourScrollLeft.current = element.scrollLeft
  }, [playheadX, half])

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
  const captioned = placed.flatMap((item) => {
    if (item.kind !== "piece") return []
    const caption = captionOf(edit, item.src)
    return caption ? [{ item, text: caption.text }] : []
  })
  const hasCaptions = captioned.length > 0
  // Frames only around the view (the timeline of a long match is many screens wide)
  const visible = {
    from: playheadX - half - THUMB_MARGIN,
    to: playheadX + half + THUMB_MARGIN,
  }

  return (
    // As tall as its tracks; the playhead spans them.
    <div
      className="relative shrink-0"
      style={{ height: 96 + (hasCaptions ? 28 : 0) }}
    >
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
                thumbs={thumbs}
                visible={{
                  from: visible.from - item.x,
                  to: visible.to - item.x,
                }}
                selected={
                  item.kind === "piece" &&
                  item.clipIndex === selected?.clipIndex &&
                  item.pieceIndex === selected.pieceIndex
                }
                onSelectPiece={onSelectPiece}
                onRestoreHidden={onRestoreHidden}
                onHide={onHide}
                onRestoreCut={onRestoreCut}
                onPick={onPick}
              />
            ))}
          </div>

          {/* Captions, under their pieces */}
          {hasCaptions && (
            <div className="relative mt-1 h-6" style={{ width }}>
              {captioned.map(({ item, text }) => (
                <div
                  key={item.key}
                  data-testid="caption-track"
                  className="absolute top-0 flex h-6 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-secondary px-2 text-[11px] font-bold text-foreground"
                  style={{ left: item.x, width: item.w }}
                >
                  <span className="font-extrabold">Aa</span> {text}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* The fixed playhead, with the reel time above it */}
      <div
        aria-hidden="true"
        data-testid="playhead"
        className="pointer-events-none absolute top-[22px] bottom-2 left-1/2 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground ring-1 ring-background"
      />
      <div
        data-testid="playhead-time"
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-foreground px-[7px] py-px text-[11px] font-extrabold text-background tabular-nums"
      >
        {formatPlayhead(reelTime)}
      </div>
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
/** Labels on the track: 10px, never wrapping. */
const label = "absolute left-1.5 whitespace-nowrap text-[10px]"

/** "R19" or, for a rally cut into pieces, "R19a", "R19b"... */
function pieceTag(number: number | undefined, index: number, count: number) {
  const base = number ? `R${number}` : "Clip"
  return count > 1 ? `${base}${String.fromCharCode(97 + index)}` : base
}

function TrackItem({
  item,
  view,
  thumbs,
  visible,
  selected,
  onSelectPiece,
  onRestoreHidden,
  onHide,
  onRestoreCut,
  onPick,
}: {
  item: PlacedItem
  view: Edit["view"]
  thumbs: Thumbnails | undefined
  /** The x range (in this item's coordinates) where frames are drawn. */
  visible: { from: number; to: number }
  selected: boolean
  onSelectPiece: (piece: PieceRef, sourceTime: number) => void
  onRestoreHidden: (hidden: Hidden) => void
  onHide: (region: Span) => void
  onRestoreCut: (clipIndex: number, span: Span) => void
  onPick: (rally: RallyPublic) => void
}) {
  const position = { left: item.x, width: item.w }
  const length = item.src.end - item.src.start
  const onScreen = visible.to > 0 && visible.from < item.w
  const frames = (className?: string) =>
    thumbs &&
    onScreen && (
      <ThumbStrip
        thumbs={thumbs}
        src={item.src}
        width={item.w}
        visible={visible}
        className={className}
      />
    )
  const wide = item.w >= 34

  switch (item.kind) {
    case "piece": {
      const number = item.segment?.number
      const reelLength = item.reel.end - item.reel.start
      const part =
        item.pieceCount > 1
          ? ` part ${item.pieceIndex + 1} of ${item.pieceCount}`
          : ""
      // Tap: select this piece, with the playhead where the finger was.
      const onClick = (event: MouseEvent<HTMLButtonElement>) => {
        const box = event.currentTarget.getBoundingClientRect()
        const fraction =
          event.detail === 0 || box.width === 0
            ? 0.5 // keyboard
            : Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
        onSelectPiece(
          { clipIndex: item.clipIndex, pieceIndex: item.pieceIndex },
          item.src.start + fraction * length,
        )
      }
      return (
        <button
          type="button"
          data-testid="clip"
          aria-label={`${number ? `Rally ${number}` : "Clip"}${part}, ${formatPlayhead(reelLength)}`}
          aria-pressed={selected}
          onClick={onClick}
          className={cn(base, "bg-court")}
          style={{
            ...position,
            ...(!thumbs && {
              backgroundImage:
                "repeating-linear-gradient(90deg, color-mix(in oklab, var(--chapter) 35%, transparent) 0 1px, transparent 1px 30px)",
            }),
          }}
        >
          {frames()}
          {wide && (
            <span
              className={cn(
                label,
                "top-[5px] rounded-[5px] bg-court-ink/85 px-[5px] py-px font-extrabold text-court-foreground tabular-nums",
              )}
            >
              {pieceTag(number, item.pieceIndex, item.pieceCount)} ·{" "}
              {formatPlayhead(reelLength)}
            </span>
          )}
          {item.piece.slow_mo && wide && (
            <span
              data-testid="slow-mo-badge"
              className={cn(
                label,
                "bottom-[5px] rounded-[5px] bg-court-foreground px-[5px] py-px font-extrabold text-court-ink",
              )}
            >
              Slow-mo
            </span>
          )}
          {selected && (
            // Over the frames: a 3px pink inset ring
            <span className="pointer-events-none absolute inset-0 rounded-[8px] ring-[3px] ring-highlight ring-inset" />
          )}
        </button>
      )
    }
    case "gap": {
      // A short cut needs tenths ("0:00.4"), a long break doesn't ("0:35")
      const hidden = item.src.end - item.src.start
      const text = hidden < 10 ? formatPlayhead(hidden) : formatDuration(hidden)
      return (
        <button
          type="button"
          data-testid="gap"
          aria-label={`Show ${text} of hidden footage`}
          onClick={() => onRestoreHidden(item.hidden)}
          className={cn(
            base,
            "flex flex-col items-center justify-center gap-0.5 bg-sheet text-[10px] font-extrabold text-muted-foreground ring-1 ring-muted-foreground/60 ring-inset tabular-nums",
          )}
          style={position}
        >
          <ChevronsLeftRight className="size-3.5" strokeWidth={2.4} />
          {text}
        </button>
      )
    }
    case "cut": {
      const number = item.segment?.number
      return (
        <button
          type="button"
          data-testid="cut"
          aria-label={`Cut part of ${number ? `rally ${number}` : "the clip"}, ${formatPlayhead(length)}. Tap to put it back`}
          onClick={() => onRestoreCut(item.clipIndex, item.src)}
          className={base}
          style={{
            ...position,
            backgroundImage:
              "repeating-linear-gradient(135deg, color-mix(in oklab, var(--highlight) 22%, var(--card)) 0 4px, var(--card) 4px 9px)",
          }}
        >
          {wide && (
            <span
              className={cn(
                label,
                "top-[5px] font-bold text-muted-foreground tabular-nums",
              )}
            >
              Cut {formatPlayhead(length)}
            </span>
          )}
        </button>
      )
    }
    case "break": {
      const text = wide && (
        <span
          className={cn(
            label,
            "top-[5px] rounded-[5px] font-bold tabular-nums",
            view === "cut"
              ? "bg-court-ink/85 px-[5px] py-px text-court-foreground"
              : "text-muted-foreground",
          )}
        >
          Break {formatDuration(length)}
        </span>
      )
      // Full video: breaks are just footage (striped). Rallies only: a restored
      // break shows its frames and can be hidden again with a tap.
      return view === "cut" ? (
        <button
          type="button"
          data-testid="break"
          aria-label={`Break, ${formatDuration(length)}, tap to cut again`}
          onClick={() => onHide(item.region)}
          className={cn(base, "bg-card")}
          style={position}
        >
          {frames("opacity-60")}
          {text}
        </button>
      ) : (
        <div
          data-testid="break"
          className={base}
          style={{
            ...position,
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--card) 0 6px, var(--secondary) 6px 12px)",
          }}
        >
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
            thumbs
              ? "bg-card text-foreground"
              : "bg-court/45 text-foreground ring-1 ring-chapter/50 ring-inset",
          )}
          style={position}
        >
          {frames("opacity-35")}
          {wide && (
            <>
              <span className={cn(label, "top-[5px] font-extrabold")}>
                R{item.segment.number}
              </span>
              <span className={cn(label, "bottom-[5px] font-bold")}>+ add</span>
            </>
          )}
        </button>
      )
  }
}
