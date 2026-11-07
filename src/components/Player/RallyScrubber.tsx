import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react"

import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type Segment, segmentAt } from "./rallies"

const KEY_STEP = 5 // seconds per arrow key press

/**
 * Timeline with each rally drawn as a chapter segment (position = time / duration).
 * Click, tap or drag to seek; arrow keys move 5 s when it has focus.
 */
export function RallyScrubber({
  duration,
  time,
  segments,
  currentNumber,
  onSeek,
  onScrubbingChange,
}: {
  duration: number
  time: number
  segments: Segment[]
  currentNumber: number | undefined
  onSeek: (t: number) => void
  onScrubbingChange: (scrubbing: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const percent = (t: number) =>
    `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`

  const timeAt = (event: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const fraction = (event.clientX - rect.left) / rect.width
    return Math.min(1, Math.max(0, fraction)) * duration
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    ref.current!.setPointerCapture(event.pointerId)
    setDragging(true)
    onScrubbingChange(true)
    const t = timeAt(event)
    setHover(t)
    onSeek(t)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    const t = timeAt(event)
    if (dragging) onSeek(t)
    if (dragging || event.pointerType === "mouse") setHover(t)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    onScrubbingChange(false)
    if (event.pointerType !== "mouse") setHover(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.key === "ArrowLeft"
        ? time - KEY_STEP
        : event.key === "ArrowRight"
          ? time + KEY_STEP
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? duration
              : null
    if (target === null) return
    event.preventDefault()
    onSeek(Math.min(duration, Math.max(0, target)))
  }

  const hoverSegment = hover !== null ? segmentAt(segments, hover) : undefined
  const currentSegment = segments.find((s) => s.number === currentNumber)

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatDuration(time)}${currentSegment ? `, rally ${currentSegment.number}` : ""}`}
      data-testid="scrubber"
      // Tall invisible hit area around a thin track; no scrolling while dragging.
      className="group relative h-8 cursor-pointer touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted transition-[height] group-hover:h-3">
        {segments.map((s) => (
          <div
            key={s.number}
            data-testid="chapter"
            className={cn(
              "absolute inset-y-0",
              s.number === currentNumber ? "bg-primary" : "bg-primary/45",
            )}
            // A 1.5 s rally in a 20 min video is under 1 px on a phone: keep it visible.
            style={{
              left: percent(s.rally.start),
              width: `max(2px, ${percent(s.rally.duration)})`,
            }}
          />
        ))}
        {/* Played part, as a light veil over everything before the playhead */}
        <div
          className="absolute inset-y-0 left-0 bg-foreground/20"
          style={{ width: percent(time) }}
        />
      </div>

      <div
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow ring-2 ring-background"
        style={{ left: percent(time) }}
      />

      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs tabular-nums text-popover-foreground shadow-md"
          // Keep the label inside the bar at both ends.
          style={{ left: `clamp(3rem, ${percent(hover)}, calc(100% - 3rem))` }}
        >
          {hoverSegment ? `Rally ${hoverSegment.number} · ` : ""}
          {formatDuration(hover)}
        </div>
      )}
    </div>
  )
}
