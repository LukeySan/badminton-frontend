import { Plus } from "lucide-react"
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { RallyPublic } from "@/client"
import { isMaybe } from "@/components/Player/rallies"
import { formatDuration, formatPlayhead } from "@/lib/format"
import { capturePointer, cn } from "@/lib/utils"
import { ReorderStrip } from "./ReorderStrip"
import {
  type Clip,
  captionOf,
  clipLength,
  type Edit,
  MIN_CLIP,
  round1,
  type Span,
} from "./reelEdit"
import { type Thumbnails, ThumbStrip } from "./thumbnails"
import {
  atX,
  clampZoom,
  DEFAULT_PX_PER_SECOND,
  dragEdge,
  layOut,
  MIN_CLIP_WIDTH,
  type PlacedClip,
  rulerStep,
  rulerTicks,
  xAtReelTime,
} from "./timeline"

export type Edge = "start" | "end"

export type TimelineCallbacks = {
  /** The user started moving the timeline (pause playback). */
  onScrubStart: () => void
  /** The user moved the timeline: clip `index` is under the playhead, at `source`. */
  onScrub: (index: number, source: number) => void
  /** A clip was tapped, at this moment of the video. */
  onSelect: (id: string, source: number) => void
  /** An edge drag started (pause). */
  onEdgeDragStart: () => void
  /** While an edge moves: show this moment (the screen throttles the seeks). */
  onPreview: (source: number) => void
  /** A finished edge drag (one undo step), or one arrow-key step on a handle. */
  onSetBounds: (id: string, span: Span, edge: Edge) => void
  /** A finished reorder drag (one undo step). */
  onMove: (id: string, to: number) => void
  /** The "+" tile: Add footage. */
  onAdd: () => void
  /** Press and hold on a clip: it's being moved (pause playback). */
  onMoveStart: () => void
  /** The move is over (dropped or not): select that clip. */
  onMoveEnd: (id: string) => void
}

/**
 * Whether each clip shows a "maybe" rally (drawn faded and dashed). Clips carry no
 * rally names: a clip is footage, and its edges can go anywhere in the match.
 */
export function clipMaybes(
  segments: Clip[],
  rallies: RallyPublic[],
): boolean[] {
  const maybe = new Set(rallies.filter(isMaybe).map((rally) => rally.id))
  return segments.map(
    (clip) => clip.rally_id !== null && maybe.has(clip.rally_id),
  )
}

/** What an edge drag is doing, for the label over the handle and the hint. */
type DragInfo = {
  id: string
  edge: Edge
  span: Span
  rally: RallyPublic | undefined
}

/** "+1.2 s past rally end", "At rally start"... (undefined: inside the rally, or none). */
function beyondText(drag: DragInfo): string | undefined {
  const { rally, span, edge } = drag
  if (!rally) return undefined
  const past = edge === "end" ? span.end - rally.end : rally.start - span.start
  if (Math.abs(past) <= 0.05)
    return edge === "end" ? "At rally end" : "At rally start"
  if (past < 0) return undefined
  return edge === "end"
    ? `+${past.toFixed(1)} s past rally end`
    : `+${past.toFixed(1)} s before rally start`
}

/**
 * Edit mode: the timeline, the hint under it, then the tool row (`children`).
 * Everything that changes the reel is a callback that goes through the reducer.
 *
 * Moving a clip has no mode: press and hold one (LONG_PRESS_MS), and while that
 * press drags it every clip shrinks to a thumbnail so the whole reel fits
 * (ReorderStrip, over the timeline); on release it's back to normal.
 *
 * Touch: one finger scrolls the timeline natively (momentum for free). Our own
 * gestures (an edge drag, a held clip, a pinch) stop the browser from scrolling or
 * zooming the page by cancelling `touchmove` here, which React can't do (its touch
 * listeners are passive).
 */
export function EditPanel({
  edit,
  rallies,
  duration,
  reelTime,
  selectedId,
  thumbs,
  callbacks,
  children,
}: {
  edit: Edit
  rallies: RallyPublic[]
  duration: number
  /** Where the playhead is, in reel time. */
  reelTime: number
  selectedId: string | undefined
  thumbs: Thumbnails | undefined
  callbacks: TimelineCallbacks
  /** The tool row. */
  children?: ReactNode
}) {
  const rootRef = useRef<HTMLElement>(null)
  /** One of our gestures owns the touch: the browser mustn't scroll or zoom. */
  const blockTouch = useRef(false)
  const [drag, setDrag] = useState<DragInfo | null>(null)
  /** A held clip being moved (the press is still down): the strip follows it. */
  const [moving, setMoving] = useState<Handoff | null>(null)
  const maybes = useMemo(
    () => clipMaybes(edit.segments, rallies),
    [edit.segments, rallies],
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onTouchMove = (event: TouchEvent) => {
      if ((blockTouch.current || event.touches.length >= 2) && event.cancelable)
        event.preventDefault()
    }
    // Safari: no page zoom from a pinch on the timeline
    const onGesture = (event: Event) => event.preventDefault()
    root.addEventListener("touchmove", onTouchMove, { passive: false })
    root.addEventListener("gesturestart", onGesture)
    return () => {
      root.removeEventListener("touchmove", onTouchMove)
      root.removeEventListener("gesturestart", onGesture)
    }
  }, [])

  const hint = moving ? (
    "Drag it where you want it and let go. The other clips make room."
  ) : drag ? (
    beyondText(drag)?.startsWith("+") ? (
      drag.edge === "end" ? (
        "Revealing footage after the detected end. The dashed line marks where the rally was detected."
      ) : (
        "Revealing footage before the detected start. The dashed line marks where the rally was detected."
      )
    ) : (
      "Drag out to show more, in to shorten. Snaps to the detected rally start and end."
    )
  ) : (
    <>
      Drag the pink edges to show more or less. Hold and drag a clip to move it.{" "}
      <ZoomHint />
    </>
  )

  return (
    <section
      ref={rootRef}
      aria-label="Edit"
      onContextMenu={(event) => {
        // A long press is ours (moving the clip), not the browser's menu
        if ((event.target as HTMLElement).closest("[data-clip-id]"))
          event.preventDefault()
      }}
      className="flex min-h-0 flex-1 flex-col select-none [-webkit-touch-callout:none]"
    >
      <div
        className="relative h-(--tracks) shrink-0 max-md:portrait:h-auto max-md:portrait:min-h-(--tracks) max-md:portrait:flex-1"
        style={
          {
            "--tracks": `${118 + (edit.captions.length > 0 ? 30 : 0)}px`,
          } as CSSProperties
        }
      >
        <Timeline
          edit={edit}
          maybes={maybes}
          rallies={rallies}
          duration={duration}
          reelTime={reelTime}
          selectedId={selectedId}
          thumbs={thumbs}
          hidden={moving !== null}
          blockTouch={blockTouch}
          onDrag={setDrag}
          onLongPress={(press) => {
            setMoving(press)
            callbacks.onMoveStart()
          }}
          {...callbacks}
        />
        {moving && (
          <ReorderStrip
            segments={edit.segments}
            maybes={maybes}
            thumbs={thumbs}
            handoff={moving}
            blockTouch={blockTouch}
            onMove={callbacks.onMove}
            onEnd={(id) => {
              setMoving(null)
              callbacks.onMoveEnd(id)
            }}
          />
        )}
      </div>
      <p
        data-testid="selection-hint"
        aria-live="polite"
        className="flex min-h-[34px] shrink-0 items-center px-4 py-0.5 text-xs leading-[1.3] text-muted-foreground md:px-0"
      >
        <span>{hint}</span>
      </p>
      {children}
    </section>
  )
}

/** Phones pinch; a mouse has no pinch, so say what does it there. */
function ZoomHint() {
  return (
    <>
      <span className="pointer-fine:hidden">Pinch to zoom.</span>
      <span className="hidden pointer-fine:inline">
        Pinch or Ctrl + scroll to zoom.
      </span>
    </>
  )
}

export type Handoff = { id: string; pointerId: number; clientX: number }

/** After the last scroll event of a gesture (incl. momentum), give control back. */
const SCRUB_IDLE_MS = 180
/** A mouse drag shorter than this is a click; a finger moving more isn't a long press. */
const DRAG_THRESHOLD = 4
const PRESS_SLOP = 8
/** Press and hold this long on a clip: reorder. */
const LONG_PRESS_MS = 250
/** Frames are drawn this far beyond each side of the view (px). */
const THUMB_MARGIN = 360
/** The "+" tile after the last clip. */
const ADD_TILE = { gap: 6, width: 48 }
const TRACK_HEIGHT = 72

type EdgeGesture = {
  pointerId: number
  id: string
  edge: Edge
  startX: number
  origin: Span
  /** Pixels per source second (slow-mo is drawn twice as wide). */
  scale: number
  width: number
  snapped: number | undefined
  /** Where the edge is now. */
  span: Span
  /** Its rally's detected start and end (the edge snaps to them). */
  snaps: number[]
  /** Where the finger is (a second finger turns the drag into a pinch). */
  lastX: number
  lastY: number
}

/**
 * TikTok-style timeline: a fixed playhead in the middle, the reel moving under it.
 * While playing, the timeline follows the video; while the user moves it, the video
 * follows the timeline. The selected clip has pink edge handles.
 */
function Timeline({
  edit,
  maybes,
  rallies,
  duration,
  reelTime,
  selectedId,
  thumbs,
  hidden,
  blockTouch,
  onDrag,
  onLongPress,
  onScrubStart,
  onScrub,
  onSelect,
  onEdgeDragStart,
  onPreview,
  onSetBounds,
  onAdd,
  onMove,
}: {
  edit: Edit
  maybes: boolean[]
  rallies: RallyPublic[]
  duration: number
  reelTime: number
  selectedId: string | undefined
  thumbs: Thumbnails | undefined
  /** Reordering: kept in place (a press that started here carries on) but not shown. */
  hidden: boolean
  blockTouch: RefObject<boolean>
  onDrag: (drag: DragInfo | null) => void
  onLongPress: (press: Handoff) => void
} & TimelineCallbacks) {
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND)
  const zoom = useRef(pxPerSecond)
  zoom.current = pxPerSecond
  const [draft, setDraft] = useState<{ id: string; span: Span } | null>(null)
  const segments = useMemo(
    () =>
      draft
        ? edit.segments.map((clip) =>
            clip.id === draft.id ? { ...clip, ...draft.span } : clip,
          )
        : edit.segments,
    [edit.segments, draft],
  )
  const { placed, width } = useMemo(
    () => layOut(segments, pxPerSecond),
    [segments, pxPerSecond],
  )
  const layout = useRef(placed)
  layout.current = placed
  const scrollRef = useRef<HTMLElement>(null)
  const [half, setHalf] = useState(0)
  const halfRef = useRef(half)
  halfRef.current = half

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
      window.clearTimeout(press.current?.timer)
      if (frame.current) cancelAnimationFrame(frame.current)
    },
    [],
  )
  /** The user is moving things: playback doesn't move the timeline until they stop. */
  const touchActive = () => {
    if (!userActive.current) {
      userActive.current = true
      onScrubStart()
    }
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (!edgeDrag.current && !pinch.current) userActive.current = false
    }, SCRUB_IDLE_MS)
  }

  const playheadX = xAtReelTime(placed, reelTime)
  const playheadRef = useRef(playheadX)
  playheadRef.current = playheadX
  /**
   * Focus moved into the timeline (a dialog giving focus back to "+", Tab): the
   * browser scrolls the focused element into view. That's not the user moving the
   * timeline, so the view goes back to the playhead instead of seeking.
   */
  const focusScroll = useRef(false)
  const onFocusCapture = () => {
    focusScroll.current = true
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        focusScroll.current = false
      }),
    )
  }
  // Follow playback (and edits that move things around), unless the user is moving it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: half and the layout change the scroll range
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || userActive.current) return
    element.scrollLeft = playheadX
    ourScrollLeft.current = element.scrollLeft
  }, [playheadX, half, placed])

  /** What's under the playhead now: report it (at most once a frame). */
  const scrubToScroll = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      const element = scrollRef.current
      const hit = element && atX(layout.current, element.scrollLeft)
      if (!hit) return
      const item = layout.current[hit.index]
      const k = item.clip.slow_mo ? 2 : 1
      onScrub(hit.index, item.clip.start + (hit.reelTime - item.reel.start) / k)
    })
  }

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    // Our own scroll (following playback, keeping an edge in place): nothing to do.
    if (
      ourScrollLeft.current !== null &&
      Math.abs(element.scrollLeft - ourScrollLeft.current) < 1
    )
      return
    ourScrollLeft.current = null
    if (edgeDrag.current) return
    if (
      focusScroll.current &&
      pointers.current.size === 0 &&
      !mouseDrag.current &&
      !userActive.current
    ) {
      element.scrollLeft = playheadRef.current
      ourScrollLeft.current = element.scrollLeft
      return
    }
    touchActive()
    scrubToScroll()
  }

  // --- Zoom: pinch (two fingers), ctrl + wheel / trackpad pinch, Safari gestures ----
  /** After a zoom: scroll so the moment under the pinch stays under it. */
  const anchor = useRef<{ t: number; offset: number } | null>(null)
  const zoomTo = (next: number, clientX: number) => {
    const element = scrollRef.current
    if (!element) return
    const px = clampZoom(next)
    if (Math.abs(px - zoom.current) < 1e-3) return
    const offset = clientX - element.getBoundingClientRect().left
    const hit = atX(
      layout.current,
      element.scrollLeft + offset - halfRef.current,
    )
    anchor.current = { t: hit?.reelTime ?? 0, offset }
    touchActive()
    setPxPerSecond(px)
  }
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo
  useLayoutEffect(() => {
    const element = scrollRef.current
    const pending = anchor.current
    if (!element || !pending) return
    anchor.current = null
    ourScrollLeft.current = null
    element.scrollLeft =
      xAtReelTime(placed, pending.t) - pending.offset + halfRef.current
  }, [placed])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as ctrl + wheel (Chrome, Firefox, Edge)
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomRef.current(
        zoom.current * Math.exp(-event.deltaY * 0.01),
        event.clientX,
      )
    }
    // Safari's trackpad pinch (and iOS's, which the pointers already handle)
    let gestureStart = zoom.current
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureStart = zoom.current
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      if (pinch.current) return
      const gesture = event as Event & { scale: number; clientX: number }
      zoomRef.current(gestureStart * gesture.scale, gesture.clientX)
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    element.addEventListener("gesturestart", onGestureStart)
    element.addEventListener("gesturechange", onGestureChange)
    return () => {
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("gesturestart", onGestureStart)
      element.removeEventListener("gesturechange", onGestureChange)
    }
  }, [])

  // --- Pointers: pinch, long press, mouse drag to scroll ------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; px: number } | null>(null)
  const press = useRef<{
    pointerId: number
    id: string
    x: number
    y: number
    timer: number
  } | null>(null)
  const mouseDrag = useRef<{
    x: number
    scrollLeft: number
    moved: boolean
  } | null>(null)
  /** Swallow the click that ends a long press, a mouse drag or an edge drag. */
  const swallowClick = useRef(false)
  /** Until the pointer is up (and its click, if any, has come). */
  const swallowUntilUp = () => {
    swallowClick.current = true
    window.addEventListener(
      "pointerup",
      () =>
        window.setTimeout(() => {
          swallowClick.current = false
        }),
      { once: true, capture: true },
    )
  }

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      centerX: (a.x + b.x) / 2,
    }
  }
  const cancelPress = () => {
    if (!press.current) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    // A second finger while the first holds an edge: it was a pinch after all
    const edge = edgeDrag.current
    if (edge && edge.pointerId !== event.pointerId) {
      abandonEdge()
      pointers.current.set(edge.pointerId, { x: edge.lastX, y: edge.lastY })
    }
    if (pointers.current.size === 2) {
      cancelPress()
      mouseDrag.current = null
      pinch.current = { distance: spread().distance, px: zoom.current }
      blockTouch.current = true
      touchActive()
      return
    }
    if (pointers.current.size > 2) return
    const clipElement = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-clip-id]",
    )
    const id = clipElement?.dataset.clipId
    if (id) {
      const { pointerId, clientX, clientY } = event
      press.current = {
        pointerId,
        id,
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          const current = press.current
          press.current = null
          mouseDrag.current = null
          if (!current) return
          swallowUntilUp()
          navigator.vibrate?.(12)
          onLongPress({ id, pointerId, clientX: current.x })
        }, LONG_PRESS_MS),
      }
    }
    if (event.pointerType === "mouse") {
      mouseDrag.current = {
        x: event.clientX,
        scrollLeft: scrollRef.current!.scrollLeft,
        moved: false,
      }
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointers.current.get(event.pointerId)
    if (!point) return
    point.x = event.clientX
    point.y = event.clientY
    if (pinch.current && pointers.current.size >= 2) {
      const { distance, centerX } = spread()
      if (pinch.current.distance > 0)
        zoomTo(pinch.current.px * (distance / pinch.current.distance), centerX)
      return
    }
    const held = press.current
    if (held && held.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y)
      if (moved > PRESS_SLOP) cancelPress()
      else {
        // Small wobble while holding: remember where the finger is for the handoff
        held.x = event.clientX
        held.y = event.clientY
      }
    }
    const current = mouseDrag.current
    if (!current) return
    const dx = event.clientX - current.x
    if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    if (!current.moved) {
      current.moved = true
      cancelPress()
      // Capture only once it's a drag, so plain clicks still reach the clips.
      capturePointer(scrollRef.current!, event.pointerId)
    }
    scrollRef.current!.scrollLeft = current.scrollLeft - dx
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    if (press.current?.pointerId === event.pointerId) cancelPress()
    if (pinch.current && pointers.current.size < 2) {
      pinch.current = null
      if (!edgeDrag.current) blockTouch.current = false
      touchActive()
    }
    if (mouseDrag.current?.moved) {
      swallowClick.current = true
      window.setTimeout(() => {
        swallowClick.current = false
      })
    }
    mouseDrag.current = null
  }

  // --- Edge handles -----------------------------------------------------------------
  const edgeDrag = useRef<EdgeGesture | null>(null)
  const startEdge = (
    event: ReactPointerEvent<HTMLElement>,
    item: PlacedClip,
    edge: Edge,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.stopPropagation()
    capturePointer(event.currentTarget, event.pointerId)
    cancelPress()
    edgeDrag.current = {
      pointerId: event.pointerId,
      id: item.clip.id,
      edge,
      startX: event.clientX,
      origin: { start: item.clip.start, end: item.clip.end },
      scale: pxPerSecond * (item.clip.slow_mo ? 2 : 1),
      width: item.w,
      snapped: undefined,
      span: { start: item.clip.start, end: item.clip.end },
      snaps: rallies
        .filter((rally) => rally.id === item.clip.rally_id)
        .flatMap((rally) => [rally.start, rally.end]),
      lastX: event.clientX,
      lastY: event.clientY,
    }
    blockTouch.current = true
    userActive.current = true
    window.clearTimeout(idleTimer.current)
    onEdgeDragStart()
    report(item.clip.id, edge, edgeDrag.current.origin)
  }
  const report = (id: string, edge: Edge, span: Span) => {
    const clip = edit.segments.find((c) => c.id === id)
    onDrag({
      id,
      edge,
      span,
      rally: rallies.find((r) => r.id === clip?.rally_id),
    })
    onPreview(
      edge === "start" ? span.start : Math.max(span.start, span.end - 0.05),
    )
  }
  const moveEdge = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = edgeDrag.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    const { span, snapped } = dragEdge({
      origin: gesture.origin,
      edge: gesture.edge,
      dx: event.clientX - gesture.startX,
      pxPerSecond: gesture.scale,
      snaps: gesture.snaps,
      duration,
    })
    if (snapped !== undefined && snapped !== gesture.snapped)
      navigator.vibrate?.(8)
    gesture.snapped = snapped
    // Dragging the start: keep the clip's end where it is on screen, so the handle
    // stays under the finger (everything before it doesn't move in the layout).
    const width = Math.max(
      MIN_CLIP_WIDTH,
      (span.end - span.start) * gesture.scale,
    )
    if (gesture.edge === "start") {
      const element = scrollRef.current
      if (element) {
        element.scrollLeft += width - gesture.width
        ourScrollLeft.current = element.scrollLeft
      }
    }
    gesture.width = width
    gesture.span = span
    setDraft({ id: gesture.id, span })
    report(gesture.id, gesture.edge, span)
  }
  /** Stop an edge drag without changing the clip (it became a pinch). */
  const abandonEdge = () => {
    edgeDrag.current = null
    setDraft(null)
    onDrag(null)
  }
  const endEdge = (event: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    const gesture = edgeDrag.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    edgeDrag.current = null
    blockTouch.current = false
    swallowClick.current = true
    window.setTimeout(() => {
      swallowClick.current = false
    })
    const { span } = gesture
    setDraft(null)
    onDrag(null)
    userActive.current = false
    // Never moved: a tap. A narrow clip's handles sit over its neighbours, so the
    // tap goes to the clip under the finger, as if the handle weren't there.
    const moved = Math.abs(gesture.lastX - gesture.startX) >= DRAG_THRESHOLD
    const below = moved ? undefined : clipUnder(event.clientX, event.clientY)
    if (commit && below) {
      onSelect(below.id, below.at(event.clientX))
      return
    }
    // Back to following the playhead, which the screen puts on the moved edge (a
    // cancelled drag "sets" the old bounds: no change, no undo step, and the video
    // leaves the previewed frame)
    onSetBounds(gesture.id, commit ? span : gesture.origin, gesture.edge)
  }
  /** The clip (not a handle) under a point, and the moment of it at an x. */
  const clipUnder = (x: number, y: number) => {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element.closest("[role='slider']")) continue
      const id = element.closest<HTMLElement>("[data-clip-id]")?.dataset.clipId
      const clip = id && edit.segments.find((c) => c.id === id)
      const button = element.closest("[data-testid='clip']")
      if (!clip || !button) continue
      const box = button.getBoundingClientRect()
      return {
        id: clip.id,
        at: (clientX: number) =>
          clip.start +
          (box.width > 0
            ? Math.min(1, Math.max(0, (clientX - box.left) / box.width))
            : 0) *
            (clip.end - clip.start),
      }
    }
    return undefined
  }
  /** Arrow keys on a handle: 0.1 s (Shift: 1 s) per press. */
  const onEdgeKey = (
    event: KeyboardEvent<HTMLElement>,
    clip: Clip,
    edge: Edge,
  ) => {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (!step) return
    event.preventDefault()
    const delta = step * (event.shiftKey ? 1 : 0.1)
    const span =
      edge === "start"
        ? { start: round1(clip.start + delta), end: clip.end }
        : { start: clip.start, end: round1(clip.end + delta) }
    if (span.end - span.start < MIN_CLIP - 1e-9) return
    onSetBounds(clip.id, span, edge)
  }

  const step = rulerStep(pxPerSecond)
  const ticks = useMemo(() => rulerTicks(placed, step), [placed, step])
  const captioned = placed.flatMap((item) => {
    const caption = captionOf(edit, item.clip)
    return caption ? [{ item, text: caption.text }] : []
  })
  // Frames only around the view (a zoomed-in reel is many screens wide)
  const visible = {
    from: playheadX - half - THUMB_MARGIN,
    to: playheadX + half + THUMB_MARGIN,
  }
  const trackWidth = width + ADD_TILE.gap + ADD_TILE.width

  return (
    <div
      className={cn("absolute inset-0", hidden && "invisible")}
      aria-hidden={hidden || undefined}
    >
      <section
        ref={scrollRef}
        aria-label="Reel timeline"
        data-testid="timeline"
        data-zoom={pxPerSecond.toFixed(2)}
        // Focusable: arrow keys scroll it (and so move the playhead).
        tabIndex={hidden ? -1 : 0}
        onScroll={onScroll}
        onFocusCapture={onFocusCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            swallowClick.current = false
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        className="absolute inset-0 touch-pan-x overflow-x-auto overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="relative pt-1"
          style={{ width: trackWidth + 2 * half, paddingLeft: half }}
        >
          {/* Ruler (reel time) */}
          <div className="relative h-5" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.t}
                className="absolute top-0.5 h-3.5 whitespace-nowrap border-l pl-[3px] text-[10px] leading-3.5 text-muted-foreground/70 tabular-nums"
                style={{ left: tick.x }}
              >
                {step < 1 ? formatPlayhead(tick.t) : formatDuration(tick.t)}
              </span>
            ))}
          </div>

          {/* Clip track, then the "+" tile */}
          <div
            className="relative mt-2.5"
            style={{ width: trackWidth, height: TRACK_HEIGHT }}
          >
            {placed.map((item) => (
              <ClipItem
                key={item.clip.id}
                item={item}
                count={placed.length}
                maybe={maybes[item.index]}
                onKey={(event) => {
                  // Alt + ← / →: move the clip a place (holding and dragging
                  // without a pointer)
                  if (!event.altKey) return
                  const step =
                    event.key === "ArrowLeft"
                      ? -1
                      : event.key === "ArrowRight"
                        ? 1
                        : 0
                  const to = item.index + step
                  if (!step || to < 0 || to >= placed.length) return
                  event.preventDefault()
                  onMove(item.clip.id, to)
                }}
                thumbs={thumbs}
                visible={{
                  from: visible.from - item.x,
                  to: visible.to - item.x,
                }}
                selected={item.clip.id === selectedId}
                draft={draft?.id === item.clip.id ? draft.span : undefined}
                draggingEdge={
                  edgeDrag.current?.id === item.clip.id
                    ? edgeDrag.current.edge
                    : undefined
                }
                rally={rallies.find((r) => r.id === item.clip.rally_id)}
                pxPerSecond={pxPerSecond}
                onTap={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  const fraction =
                    event.detail === 0 || box.width === 0
                      ? 0 // keyboard: the clip's start
                      : Math.min(
                          1,
                          Math.max(0, (event.clientX - box.left) / box.width),
                        )
                  const { clip } = item
                  onSelect(
                    clip.id,
                    clip.start + fraction * (clip.end - clip.start),
                  )
                }}
                onEdgeDown={(event, edge) => startEdge(event, item, edge)}
                onEdgeMove={moveEdge}
                onEdgeUp={(event) => endEdge(event, true)}
                onEdgeCancel={(event) => endEdge(event, false)}
                onEdgeKey={(event, edge) => onEdgeKey(event, item.clip, edge)}
              />
            ))}
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add footage from the match"
              data-testid="add-footage"
              data-add-footage=""
              className="absolute top-0 flex items-center justify-center rounded-[8px] border-[1.5px] border-muted-foreground/60 border-dashed text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: width + (placed.length ? ADD_TILE.gap : 0),
                width: ADD_TILE.width,
                height: TRACK_HEIGHT,
              }}
            >
              <Plus className="size-[22px]" strokeWidth={2.4} />
            </button>
          </div>

          {/* Captions, under their clips */}
          {captioned.length > 0 && (
            <div className="relative mt-1.5 h-6" style={{ width }}>
              {captioned.map(({ item, text }) => (
                <div
                  key={item.clip.id}
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
        className="pointer-events-none absolute top-[22px] bottom-1.5 left-1/2 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground ring-1 ring-background"
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

/** Drawn width of an edge handle; its touch area is 44 px wide around it. */
const HANDLE_WIDTH = 16
const HANDLE_TOUCH = 44

function ClipItem({
  item,
  count,
  maybe,
  onKey,
  thumbs,
  visible,
  selected,
  draft,
  draggingEdge: dragging,
  rally,
  pxPerSecond,
  onTap,
  onEdgeDown,
  onEdgeMove,
  onEdgeUp,
  onEdgeCancel,
  onEdgeKey,
}: {
  item: PlacedClip
  count: number
  /** It shows a "maybe" rally: faded and dashed. */
  maybe: boolean
  onKey: (event: KeyboardEvent<HTMLButtonElement>) => void
  thumbs: Thumbnails | undefined
  /** The x range (in this clip's coordinates) where frames are drawn. */
  visible: { from: number; to: number }
  selected: boolean
  /** Its bounds while an edge is being dragged. */
  draft: Span | undefined
  draggingEdge: Edge | undefined
  rally: RallyPublic | undefined
  pxPerSecond: number
  onTap: (event: MouseEvent<HTMLButtonElement>) => void
  onEdgeDown: (event: ReactPointerEvent<HTMLElement>, edge: Edge) => void
  onEdgeMove: (event: ReactPointerEvent<HTMLElement>) => void
  onEdgeUp: (event: ReactPointerEvent<HTMLElement>) => void
  onEdgeCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onEdgeKey: (event: KeyboardEvent<HTMLElement>, edge: Edge) => void
}) {
  const { clip, w } = item
  const span = draft ?? clip
  const length = clipLength(clip)

  const onScreen = visible.to > 0 && visible.from < w
  const wide = w >= 40
  const k = clip.slow_mo ? 2 : 1
  // While dragging: the footage beyond the detected rally, tinted, with a dashed line
  // where the detector put the boundary
  const before =
    draft && rally && dragging === "start"
      ? Math.max(0, rally.start - span.start) * k * pxPerSecond
      : 0
  const after =
    draft && rally && dragging === "end"
      ? Math.max(0, span.end - rally.end) * k * pxPerSecond
      : 0
  const dragText =
    draft && dragging
      ? beyondText({ id: clip.id, edge: dragging, span, rally })
      : undefined
  // Handles sit inside the clip's edges, or outside a clip too narrow for both
  const inside = w >= 3 * HANDLE_WIDTH
  const handle = (edge: Edge) => {
    const visibleLeft =
      edge === "start"
        ? inside
          ? 0
          : -HANDLE_WIDTH
        : inside
          ? w - HANDLE_WIDTH
          : w
    const value = edge === "start" ? span.start : span.end
    return (
      // A slider: drag it (touch / mouse), or arrow keys (0.1 s, Shift: 1 s)
      <div
        role="slider"
        tabIndex={0}
        aria-label={
          edge === "start"
            ? "Drag to change the start"
            : "Drag to change the end"
        }
        aria-valuemin={0}
        aria-valuenow={value}
        aria-valuetext={formatPlayhead(value)}
        data-testid={`edge-${edge}`}
        onPointerDown={(event) => onEdgeDown(event, edge)}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
        onPointerCancel={onEdgeCancel}
        onKeyDown={(event) => onEdgeKey(event, edge)}
        className="group absolute top-0 z-10 flex h-full touch-none justify-center outline-none"
        style={{
          left: visibleLeft - (HANDLE_TOUCH - HANDLE_WIDTH) / 2,
          width: HANDLE_TOUCH,
        }}
      >
        <span
          className={cn(
            "flex h-full items-center justify-center bg-highlight group-focus-visible:ring-2 group-focus-visible:ring-ring",
            edge === "start" ? "rounded-l-[8px]" : "rounded-r-[8px]",
          )}
          style={{ width: HANDLE_WIDTH }}
        >
          <span className="h-[22px] w-[3px] rounded-[2px] bg-highlight-foreground" />
        </span>
      </div>
    )
  }

  return (
    <div
      data-clip-id={clip.id}
      className="absolute top-0"
      style={{ left: item.x, width: w, height: TRACK_HEIGHT }}
    >
      <button
        type="button"
        data-testid="clip"
        data-selected={selected || undefined}
        aria-label={`Clip ${item.index + 1} of ${count}${maybe ? " (maybe)" : ""}${clip.slow_mo ? ", slow-mo" : ""}, ${formatPlayhead(length)}`}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        onKeyDown={onKey}
        aria-pressed={selected}
        data-maybe={maybe || undefined}
        onClick={onTap}
        className="absolute inset-0 overflow-hidden rounded-[8px] bg-court p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={
          thumbs
            ? undefined
            : {
                backgroundImage:
                  "repeating-linear-gradient(90deg, color-mix(in oklab, var(--chapter) 35%, transparent) 0 1px, transparent 1px 30px)",
              }
        }
      >
        {thumbs && onScreen && (
          <ThumbStrip
            thumbs={thumbs}
            src={span}
            width={w}
            height={TRACK_HEIGHT}
            visible={visible}
            className={maybe ? "opacity-55" : undefined}
          />
        )}
        {maybe && (
          <span className="pointer-events-none absolute inset-0 rounded-[8px] border-[1.5px] border-court-foreground/80 border-dashed" />
        )}
        {before > 0 && (
          <span
            data-testid="revealed"
            className="pointer-events-none absolute inset-y-0 left-0 border-court-foreground border-r-2 border-dashed bg-court-foreground/18"
            style={{ width: Math.min(w, before) }}
          />
        )}
        {after > 0 && (
          <span
            data-testid="revealed"
            className="pointer-events-none absolute inset-y-0 right-0 border-court-foreground border-l-2 border-dashed bg-court-foreground/18"
            style={{ width: Math.min(w, after) }}
          />
        )}
        {/* Its length, where it fits (next to the handles when selected) */}
        {w >= (selected && inside ? 90 : 52) && (
          <span
            data-testid="clip-length"
            className={cn(
              "absolute top-[5px] whitespace-nowrap rounded-[5px] bg-court-ink/85 px-[5px] py-px text-[10px] font-extrabold text-court-foreground tabular-nums",
              selected && inside ? "left-[20px]" : "left-1.5",
            )}
          >
            {formatPlayhead(clipLength({ ...clip, ...span }))}
          </span>
        )}
        {clip.slow_mo && wide && (
          <span
            data-testid="slow-mo-badge"
            className={cn(
              "absolute bottom-[5px] whitespace-nowrap rounded-[5px] bg-court-foreground px-[5px] py-px text-[10px] font-extrabold text-court-ink",
              selected && inside ? "left-[20px]" : "left-1.5",
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
      {selected && (
        <>
          {handle("start")}
          {handle("end")}
        </>
      )}
      {dragText && (
        <span
          data-testid="drag-label"
          className="pointer-events-none absolute -top-[30px] z-20 whitespace-nowrap rounded-[8px] bg-highlight px-2 py-[3px] text-[11px] font-extrabold text-highlight-foreground tabular-nums"
          // Ends at the handle, over the clip: the handle is under the finger, so it's
          // on screen, and the label grows into the screen from it
          style={dragging === "end" ? { right: 0 } : { left: 0 }}
        >
          {dragText}
        </span>
      )}
    </div>
  )
}
