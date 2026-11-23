import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { formatPlayhead } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Handoff } from "./EditPanel"
import { type Clip, clipLength } from "./reelEdit"
import { type Thumbnails, tileStyle } from "./thumbnails"

/** Thumbnail size: as wide as fits (so the whole reel shows), within these bounds. */
const THUMB = { min: 20, max: 36, height: 52, gap: 4 }
/** Near the strip's edges the held clip scrolls it (px from the edge, px per frame). */
const EDGE_ZONE = 40
const EDGE_SPEED = 8
/** The length fits on a thumbnail this wide. */
const LENGTH_FITS = 34

/**
 * The view while a held clip is being moved (not a mode: it's there for one press).
 * Every clip shrinks to a small thumbnail so the whole reel fits (if even the
 * smallest don't, the strip scrolls, by itself while the clip is near its edges). The
 * held clip follows the finger, the others slide aside to make room; on release it's
 * dropped there (`onMove`, if its place changed) and `onEnd` gives the timeline back.
 *
 * The held clip starts in its own place and moves with the finger (relative to
 * where the press was), so holding and letting go without moving changes nothing.
 * The press started on the timeline (`handoff`), which stays mounted underneath, so
 * it's followed on the window.
 */
export function ReorderStrip({
  segments,
  maybes,
  thumbs,
  handoff,
  blockTouch,
  onMove,
  onEnd,
}: {
  segments: Clip[]
  maybes: boolean[]
  thumbs: Thumbnails | undefined
  handoff: Handoff
  blockTouch: RefObject<boolean>
  onMove: (id: string, to: number) => void
  /** The press is over: select this clip. */
  onEnd: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setAvailable(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const n = segments.length
  const width = Math.min(
    THUMB.max,
    Math.max(
      THUMB.min,
      Math.floor((available - 8) / Math.max(1, n)) - THUMB.gap,
    ),
  )
  const pitch = width + THUMB.gap
  const rowWidth = n * pitch - THUMB.gap

  const from = Math.max(
    0,
    segments.findIndex((clip) => clip.id === handoff.id),
  )
  /** Where the finger is (viewport x), and where the clip would land (its index after). */
  const [drag, setDrag] = useState({ clientX: handoff.clientX, to: from })
  const dragRef = useRef(drag)
  dragRef.current = drag

  /**
   * The held clip starts in its own place and moves as much as the finger does:
   * `offset` = the finger minus that place's middle (so holding and letting go
   * without moving changes nothing).
   */
  const offset = useRef(0)
  const moved = useRef(false)
  /** The list index the held clip is over, with the finger at `clientX`. */
  const indexAt = (clientX: number) => {
    const row = rowRef.current
    if (!row) return from
    const x = clientX - offset.current - row.getBoundingClientRect().left
    return Math.min(n - 1, Math.max(0, Math.floor(x / pitch)))
  }
  const indexRef = useRef(indexAt)
  indexRef.current = indexAt
  const done = useRef({ onMove, onEnd })
  done.current = { onMove, onEnd }

  // Until the finger moves (the size settles once the strip is measured): a strip
  // wider than the screen scrolls the held clip under the finger; the offset is
  // where the finger is on it
  // biome-ignore lint/correctness/useExhaustiveDependencies: on size changes only
  useLayoutEffect(() => {
    if (moved.current) return
    const element = scrollRef.current
    const row = rowRef.current
    if (!element || !row) return
    if (element.scrollWidth > element.clientWidth) {
      element.scrollLeft +=
        row.getBoundingClientRect().left +
        from * pitch +
        width / 2 -
        handoff.clientX
    }
    offset.current =
      handoff.clientX -
      (row.getBoundingClientRect().left + from * pitch + width / 2)
    setDrag({ clientX: handoff.clientX, to: from })
  }, [pitch, width])

  useEffect(() => {
    blockTouch.current = true
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== handoff.pointerId) return
      moved.current = true
      setDrag({
        clientX: event.clientX,
        to: indexRef.current(event.clientX),
      })
    }
    const finish = (event: PointerEvent, drop: boolean) => {
      if (event.pointerId !== handoff.pointerId) return
      blockTouch.current = false
      const { to } = dragRef.current
      if (drop && to !== from) done.current.onMove(handoff.id, to)
      done.current.onEnd(handoff.id)
    }
    const onUp = (event: PointerEvent) => finish(event, true)
    const onCancel = (event: PointerEvent) => finish(event, false)
    let frame = 0
    const autoScroll = () => {
      const element = scrollRef.current
      const current = dragRef.current
      if (element) {
        const box = element.getBoundingClientRect()
        const step =
          current.clientX < box.left + EDGE_ZONE
            ? -EDGE_SPEED
            : current.clientX > box.right - EDGE_ZONE
              ? EDGE_SPEED
              : 0
        const before = element.scrollLeft
        if (step) element.scrollLeft += step
        if (element.scrollLeft !== before)
          setDrag({ ...current, to: indexRef.current(current.clientX) })
      }
      frame = requestAnimationFrame(autoScroll)
    }
    frame = requestAnimationFrame(autoScroll)
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      blockTouch.current = false
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
    }
  }, [blockTouch, from, handoff])

  const rowLeft = rowRef.current?.getBoundingClientRect().left ?? 0
  /** Where a clip is drawn: its place, or the place it makes for the held one. */
  const slotOf = (index: number) => {
    const without = index > from ? index - 1 : index
    return without >= drag.to ? without + 1 : without
  }

  return (
    <div
      data-testid="reorder"
      className="absolute inset-0 flex flex-col justify-center bg-background"
    >
      <div
        ref={scrollRef}
        className="touch-none overflow-x-auto overflow-y-hidden px-3 pt-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          ref={rowRef}
          className="relative mx-auto"
          style={{ width: rowWidth, height: THUMB.height }}
        >
          {segments.map((clip, index) => {
            const held = clip.id === handoff.id
            const left = held
              ? Math.min(
                  Math.max(
                    0,
                    drag.clientX - offset.current - rowLeft - width / 2,
                  ),
                  rowWidth - width,
                )
              : slotOf(index) * pitch
            return (
              <div
                key={clip.id}
                data-testid="reorder-clip"
                data-clip-id={clip.id}
                data-lifted={held || undefined}
                className={cn(
                  "absolute top-0 overflow-hidden rounded-[8px] bg-court",
                  held
                    ? "z-10 -translate-y-3.5 scale-[1.12] shadow-letterbox/50 shadow-xl ring-2 ring-highlight"
                    : "opacity-55 transition-[left] duration-150 ease-out",
                )}
                style={{
                  left,
                  width,
                  height: THUMB.height,
                  ...(thumbs
                    ? tileStyle(
                        thumbs,
                        (clip.start + clip.end) / 2,
                        THUMB.height,
                        width,
                      )
                    : undefined),
                }}
              >
                {maybes[index] && (
                  <span className="pointer-events-none absolute inset-0 rounded-[8px] border-[1.5px] border-court-foreground/80 border-dashed" />
                )}
                {width >= LENGTH_FITS && (
                  <span className="absolute inset-x-0 bottom-[3px] text-center text-[10px] font-extrabold text-court-foreground tabular-nums [text-shadow:0_1px_2px_var(--court-ink)]">
                    {formatPlayhead(clipLength(clip))}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
