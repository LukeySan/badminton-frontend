import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { isMaybe, type Segment } from "@/components/Player/rallies"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDuration, formatPlayhead } from "@/lib/format"
import { capturePointer, cn } from "@/lib/utils"
import { fitBounds, MIN_CLIP, round1, type Span } from "./reelEdit"
import { type Thumbnails, tileStyle } from "./thumbnails"

/** Width of one frame on the match strip. */
const SLOT = 28
const STRIP_HEIGHT = 56
const HANDLE_TOUCH = 44

/** "between rally 33 and 34", "in rally 12", "rallies 12–14", "before rally 1"... */
export function whereInMatch(span: Span, segments: Segment[]): string {
  const inside = segments.filter(
    (s) =>
      Math.min(span.end, s.rally.end) - Math.max(span.start, s.rally.start) > 0,
  )
  if (inside.length === 1) return `in rally ${inside[0].number}`
  if (inside.length > 1)
    return `rallies ${inside[0].number}–${inside[inside.length - 1].number}`
  const before = [...segments].reverse().find((s) => s.rally.end <= span.start)
  const after = segments.find((s) => s.rally.start >= span.end)
  if (before && after)
    return `between rally ${before.number} and ${after.number}`
  if (after) return `before rally ${after.number}`
  if (before) return `after rally ${before.number}`
  return "no rallies here"
}

/**
 * "+" at the end of the clip track: pick any stretch of the match (a celebration, a
 * rally the detector missed) on a scrubber of the whole match, and add it after the
 * clip under the playhead. The range is rough at this scale (a long match is a few
 * seconds per pixel); the clip's edge handles fine-tune it afterwards. The video
 * shows the frame under a handle while it moves, so the overlay is clear on phones.
 */
export function AddFootageSheet({
  open,
  onOpenChange,
  duration,
  segments,
  thumbs,
  initial,
  onPreview,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  duration: number
  /** Every rally with its number. */
  segments: Segment[]
  thumbs: Thumbnails | undefined
  /** Where the range starts when the sheet opens. */
  initial: Span
  onPreview: (t: number) => void
  onAdd: (span: Span) => void
}) {
  // Focus goes back to "+" on close, without scrolling the timeline to it (a scroll
  // there would move the playhead)
  const returnTo = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (open) returnTo.current = document.activeElement as HTMLElement | null
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // The "+" that opens it isn't "outside" (Radix's own Trigger is excluded the
        // same way): with touch, Radix dismisses on the click after a pointerdown,
        // which could be the very tap that opened it again
        onPointerDownOutside={(event) => {
          if ((event.target as Element | null)?.closest("[data-add-footage]"))
            event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // Radix calls this a moment after closing: if the sheet was opened again
          // meanwhile, focus stays in it (focusing outside would close it)
          if (!openRef.current) returnTo.current?.focus({ preventScroll: true })
        }}
        // Clear on phones (the video above previews the range); while closing it
        // lets taps through (it's invisible there, and "+" may be tapped again)
        overlayClassName="max-sm:bg-transparent data-[state=closed]:pointer-events-none"
        aria-describedby="add-footage-description"
        className={cn(
          // Above its overlay whatever their order in <body>: reopened quickly, Radix
          // can mount the overlay after the sheet, and at the same z-index it would
          // cover it
          "z-[51] gap-3 border-0 bg-sheet p-4 pt-2.5 shadow-sheet data-[state=closed]:pointer-events-none sm:max-w-lg sm:rounded-[22px]",
          // Phones: a bottom sheet
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-[22px] max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {open && (
          <AddFootageForm
            key={`${initial.start}-${initial.end}`}
            duration={duration}
            segments={segments}
            thumbs={thumbs}
            initial={initial}
            onPreview={onPreview}
            onCancel={() => onOpenChange(false)}
            onAdd={(span) => {
              onAdd(span)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type Grab = {
  pointerId: number
  part: "start" | "end" | "range"
  startX: number
  origin: Span
}

function AddFootageForm({
  duration,
  segments,
  thumbs,
  initial,
  onPreview,
  onCancel,
  onAdd,
}: {
  duration: number
  segments: Segment[]
  thumbs: Thumbnails | undefined
  initial: Span
  onPreview: (t: number) => void
  onCancel: () => void
  onAdd: (span: Span) => void
}) {
  const [range, setRange] = useState(() => fitBounds(initial, duration))
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripWidth, setStripWidth] = useState(0)
  useLayoutEffect(() => {
    const element = stripRef.current
    if (!element) return
    const measure = () => setStripWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const total = duration > 0 ? duration : 1
  const limit = Math.floor(total * 10 + 1e-6) / 10
  const secondsPerPx = stripWidth > 0 ? total / stripWidth : 0
  const pct = (t: number) => `${(t / total) * 100}%`

  const grab = useRef<Grab | null>(null)
  const move = (part: Grab["part"], origin: Span, delta: number): Span => {
    if (part === "start")
      return {
        start: Math.min(
          Math.max(0, round1(origin.start + delta)),
          round1(origin.end - MIN_CLIP),
        ),
        end: origin.end,
      }
    if (part === "end")
      return {
        start: origin.start,
        end: Math.max(
          Math.min(limit, round1(origin.end + delta)),
          round1(origin.start + MIN_CLIP),
        ),
      }
    const length = origin.end - origin.start
    const start = Math.min(
      Math.max(0, round1(origin.start + delta)),
      round1(limit - length),
    )
    return { start, end: round1(start + length) }
  }
  const show = (part: Grab["part"], span: Span) =>
    onPreview(
      part === "end" ? Math.max(span.start, span.end - 0.05) : span.start,
    )

  const onDown = (
    event: ReactPointerEvent<HTMLElement>,
    part: Grab["part"],
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.stopPropagation()
    capturePointer(event.currentTarget, event.pointerId)
    grab.current = {
      pointerId: event.pointerId,
      part,
      startX: event.clientX,
      origin: range,
    }
  }
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = grab.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = move(
      current.part,
      current.origin,
      (event.clientX - current.startX) * secondsPerPx,
    )
    setRange(next)
    show(current.part, next)
  }
  const onUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (grab.current?.pointerId === event.pointerId) grab.current = null
  }
  /** A tap on the strip outside the range: the range moves there (same length). */
  const onStripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = stripRef.current
    if (!element || stripWidth === 0) return
    const t =
      (event.clientX - element.getBoundingClientRect().left) * secondsPerPx
    const next = move("range", range, t - range.start)
    setRange(next)
    show("start", next)
  }
  /** Handles as sliders: arrow keys move them 0.1 s (Shift: 1 s), like a clip's edges. */
  const onKey = (event: KeyboardEvent<HTMLElement>, part: "start" | "end") => {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (!step) return
    event.preventDefault()
    const next = move(part, range, step * (event.shiftKey ? 1 : 0.1))
    setRange(next)
    show(part, next)
  }

  const slots = Math.ceil(stripWidth / SLOT)
  const handle = (part: "start" | "end") => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={
        part === "start" ? "Start of the footage" : "End of the footage"
      }
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={part === "start" ? range.start : range.end}
      aria-valuetext={formatPlayhead(
        part === "start" ? range.start : range.end,
      )}
      data-testid={`range-${part}`}
      onPointerDown={(event) => onDown(event, part)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={(event) => onKey(event, part)}
      className="group absolute inset-y-0 z-10 flex touch-none justify-center outline-none"
      style={{
        [part === "start" ? "left" : "right"]: -HANDLE_TOUCH / 2,
        width: HANDLE_TOUCH,
      }}
    >
      <span
        className={cn(
          "h-full w-3 bg-highlight group-focus-visible:ring-2 group-focus-visible:ring-ring",
          part === "start" ? "rounded-l-[6px]" : "rounded-r-[6px]",
        )}
      />
    </div>
  )

  return (
    <>
      <span
        aria-hidden="true"
        className="h-1 w-9 self-center rounded-[2px] bg-muted-foreground/60 sm:hidden"
      />
      <div className="flex items-baseline justify-between gap-3">
        <DialogTitle className="text-base font-extrabold">
          Add footage
        </DialogTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          Whole match · {formatDuration(duration)}
        </span>
      </div>
      <DialogDescription
        id="add-footage-description"
        className="text-xs leading-[1.35]"
      >
        Pick any part of the match, like a celebration or a rally we missed.
        Drag the handles to choose.
      </DialogDescription>

      <div
        ref={stripRef}
        data-testid="match-strip"
        onPointerDown={onStripDown}
        className="relative touch-none overflow-hidden rounded-[10px] bg-court-ink"
        style={{ height: STRIP_HEIGHT }}
      >
        {thumbs && (
          <span aria-hidden="true" className="absolute inset-0 opacity-50">
            {Array.from({ length: slots }, (_, k) => (
              <span
                key={k}
                className="absolute top-0"
                style={{
                  left: k * SLOT,
                  width: SLOT,
                  height: STRIP_HEIGHT,
                  ...tileStyle(
                    thumbs,
                    ((k + 0.5) * SLOT * total) / Math.max(1, stripWidth),
                    STRIP_HEIGHT,
                    SLOT,
                  ),
                }}
              />
            ))}
          </span>
        )}
        {segments.map((s) => (
          <span
            key={s.rally.id}
            aria-hidden="true"
            data-testid="match-chapter"
            className={cn(
              "absolute top-[18px] h-5 min-w-[3px] rounded-[3px]",
              isMaybe(s.rally)
                ? "border border-chapter border-dashed bg-chapter/30"
                : "bg-chapter/85",
            )}
            style={{
              left: pct(s.rally.start),
              width: pct(s.rally.end - s.rally.start),
            }}
          />
        ))}
        <div
          data-testid="range"
          onPointerDown={(event) => onDown(event, "range")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="absolute inset-y-0 min-w-3.5 cursor-grab bg-highlight/25 ring-2 ring-highlight"
          style={{
            left: pct(range.start),
            width: pct(range.end - range.start),
          }}
        >
          {handle("start")}
          {handle("end")}
        </div>
      </div>

      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span data-testid="range-times">
          {formatPlayhead(range.start)} to {formatPlayhead(range.end)}
        </span>
        <span
          data-testid="range-where"
          className="truncate text-right font-extrabold text-success-text"
        >
          {formatPlayhead(range.end - range.start)} ·{" "}
          {whereInMatch(range, segments)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_1.6fr] gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="lg" onClick={() => onAdd(range)}>
          Add at playhead
        </Button>
      </div>
    </>
  )
}
