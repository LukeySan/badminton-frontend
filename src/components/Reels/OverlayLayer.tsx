import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { capturePointer, cn } from "@/lib/utils"
import {
  BOX,
  clampCentre,
  FONT_METRICS,
  fontRuns,
  lineHeight,
  linePieces,
  OVERLAY_SIZE,
  OVERLAY_TEXT_MAX,
  type Overlay,
  type OverlayPatch,
  placeBox,
  safeMargin,
  THAI,
} from "./overlays"
import type { ReelFormat } from "./reelEdit"

// Overlays on the video, in Edit: drawn exactly where the export draws them, and
// edited with the fingers. One generic box (position, selection, move, resize) with
// a renderer per type: text now; the score overlay will reuse the box with its own
// renderer and no text editing.
//
// The layer covers the output frame (the video stage has the reel format's shape).
// Sizes follow the export: font size = size × the frame's height, box padding and
// corners in ems, the box centred on (x, y) and kept inside the 3% safe margin.

/** A move snaps to the frame's centre lines within this many pixels. */
const SNAP_PX = 8
/** Two taps on a text within this long: edit it. */
const DOUBLE_TAP_MS = 350
/** A press that moves less than this is a tap. */
const TAP_SLOP = 6
/** Arrow keys move a focused overlay this much (Shift: 5×), a fraction of the frame. */
const KEY_STEP = 0.01

export type OverlayLayerProps = {
  /** What's on screen now (active at the playhead, plus one being typed). */
  overlays: Overlay[]
  format: ReelFormat
  selectedId: string | undefined
  /** The text being typed into (a new one or a double-tapped one). */
  editingId: string | undefined
  /** Full screen: shown, not edited. */
  interactive: boolean
  onSelect: (id: string | undefined) => void
  /** A finished move, resize or pinch (one undo step). */
  onChange: (id: string, patch: OverlayPatch) => void
  /** A move, resize or pinch started (pause playback). */
  onGestureStart: () => void
  /** Double tap, or Enter on a focused text. */
  onStartEdit: (id: string) => void
  /** Typing is over: the text, or null when cancelled (Escape). */
  onFinishEdit: (id: string, text: string | null) => void
}

type Gesture =
  | {
      kind: "press" | "move"
      id: string
      pointerId: number
      startX: number
      startY: number
      /** The box's centre on screen when it started (px in the frame). */
      centre: { x: number; y: number }
      box: { w: number; h: number }
    }
  | {
      kind: "resize"
      id: string
      pointerId: number
      /** Distance from the box's centre (client px) where the drag started. */
      from: number
      centre: { x: number; y: number }
      size: number
    }
  | { kind: "pinch"; id: string; from: number; size: number }

/** A look in progress (during a gesture), shown instead of the stored one. */
type Draft = { id: string } & OverlayPatch

export function OverlayLayer({
  overlays,
  format,
  selectedId,
  editingId,
  interactive,
  onSelect,
  onChange,
  onGestureStart,
  onStartEdit,
  onFinishEdit,
}: OverlayLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const element = layerRef.current
    if (!element) return
    const measure = () =>
      setFrame({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The export's fonts load on first use: measure the boxes again once they're in
  const [fontsLoaded, setFontsLoaded] = useState(0)
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts) return
    const bump = () => setFontsLoaded((n) => n + 1)
    void Promise.all([
      fonts.load('800 16px "Overlay Manrope"'),
      fonts.load('800 16px "Overlay Thai"', "ก"),
    ]).then(bump, () => {})
    fonts.addEventListener("loadingdone", bump)
    return () => fonts.removeEventListener("loadingdone", bump)
  }, [])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [guides, setGuides] = useState({ x: false, y: false })
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const boxes = useRef(new Map<string, HTMLElement>())
  const lastTap = useRef<{ id: string; at: number } | null>(null)

  const margin = safeMargin(frame.w, frame.h)
  const look = (overlay: Overlay): Overlay =>
    draft?.id === overlay.id ? { ...overlay, ...draft } : overlay

  /** The box's size and centre on screen now (px in the frame). */
  const boxOf = (id: string) => {
    const element = boxes.current.get(id)
    const layer = layerRef.current
    if (!element || !layer) return undefined
    const rect = element.getBoundingClientRect()
    const origin = layer.getBoundingClientRect()
    return {
      w: element.offsetWidth,
      h: element.offsetHeight,
      centre: {
        x: rect.left + rect.width / 2 - origin.left,
        y: rect.top + rect.height / 2 - origin.top,
      },
      client: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    }
  }

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** A second finger anywhere on the frame: pinch the selected overlay. */
  const startPinch = () => {
    const id = gesture.current?.id ?? selectedId
    const overlay = overlays.find((o) => o.id === id)
    if (!overlay || pointers.current.size !== 2) return
    if (gesture.current?.kind !== "move") onGestureStart()
    gesture.current = {
      kind: "pinch",
      id: overlay.id,
      from: spread(),
      size: look(overlay).size,
    }
    setGuides({ x: false, y: false })
    if (selectedId !== overlay.id) onSelect(overlay.id)
  }

  const onBoxDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!interactive || editingId === id) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.stopPropagation()
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (pointers.current.size === 2) return startPinch()
    if (pointers.current.size > 2 || gesture.current) return
    const box = boxOf(id)
    if (!box) return
    capturePointer(layerRef.current!, event.pointerId)
    gesture.current = {
      kind: "press",
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centre: box.centre,
      box: { w: box.w, h: box.h },
    }
  }

  const onResizeDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.stopPropagation()
    const overlay = overlays.find((o) => o.id === id)
    const box = boxOf(id)
    if (!overlay || !box) return
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    capturePointer(layerRef.current!, event.pointerId)
    gesture.current = {
      kind: "resize",
      id,
      pointerId: event.pointerId,
      from: Math.max(
        1,
        Math.hypot(event.clientX - box.client.x, event.clientY - box.client.y),
      ),
      centre: box.client,
      size: look(overlay).size,
    }
    onGestureStart()
  }

  /** The empty frame (only while something is selected or typed into). */
  const frameRef = useRef<HTMLDivElement>(null)
  const onFrameDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    // Typing: a tap elsewhere keeps the text (iOS doesn't blur on its own)
    if (editingId) {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    }
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (pointers.current.size === 2) startPinch()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointers.current.get(event.pointerId)
    if (!point) return
    point.x = event.clientX
    point.y = event.clientY
    const current = gesture.current
    if (!current) return
    if (current.kind === "pinch") {
      if (pointers.current.size < 2 || current.from <= 0) return
      setDraft({
        id: current.id,
        size: clampSize(current.size * (spread() / current.from)),
      })
      return
    }
    if (current.pointerId !== event.pointerId) return
    if (current.kind === "resize") {
      const distance = Math.hypot(
        event.clientX - current.centre.x,
        event.clientY - current.centre.y,
      )
      setDraft({
        id: current.id,
        size: clampSize(current.size * (distance / current.from)),
      })
      return
    }
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.kind === "press") {
      if (Math.hypot(dx, dy) < TAP_SLOP) return
      gesture.current = { ...current, kind: "move" }
      onGestureStart()
      if (selectedId !== current.id) onSelect(current.id)
    }
    // Snap to the centre lines, then keep the box inside the safe margin
    let x = current.centre.x + dx
    let y = current.centre.y + dy
    const snapX = Math.abs(x - frame.w / 2) <= SNAP_PX
    const snapY = Math.abs(y - frame.h / 2) <= SNAP_PX
    if (snapX) x = frame.w / 2
    if (snapY) y = frame.h / 2
    setGuides({ x: snapX, y: snapY })
    setDraft({
      id: current.id,
      x: clampCentre(x / frame.w, current.box.w, frame.w, margin),
      y: clampCentre(y / frame.h, current.box.h, frame.h, margin),
    })
  }

  const onPointerEnd = (
    event: ReactPointerEvent<HTMLElement>,
    cancelled = false,
  ) => {
    if (!pointers.current.delete(event.pointerId)) return
    const current = gesture.current
    if (!current) {
      // A tap on the empty frame: nothing selected any more
      if (
        !cancelled &&
        pointers.current.size === 0 &&
        event.target === frameRef.current
      )
        onSelect(undefined)
      return
    }
    if (current.kind === "pinch") {
      // Lifting one of two fingers ends the pinch (the other one doesn't start a move)
      if (pointers.current.size > 0) return
    } else if (current.pointerId !== event.pointerId) return
    gesture.current = null
    for (const id of pointers.current.keys()) pointers.current.delete(id)
    setGuides({ x: false, y: false })
    const result = draft?.id === current.id ? draft : null
    setDraft(null)
    if (current.kind === "press") {
      if (cancelled) return
      // A tap: select; a second tap soon after: edit
      const now = performance.now()
      const previous = lastTap.current
      lastTap.current = { id: current.id, at: now }
      if (
        previous?.id === current.id &&
        now - previous.at < DOUBLE_TAP_MS &&
        selectedId === current.id
      ) {
        lastTap.current = null
        onStartEdit(current.id)
      } else if (selectedId !== current.id) onSelect(current.id)
      return
    }
    if (cancelled || !result) return
    const { id: _id, ...patch } = result
    onChange(current.id, patch)
  }

  const onBoxKey = (event: KeyboardEvent<HTMLElement>, overlay: Overlay) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSelect(overlay.id)
      onStartEdit(overlay.id)
      return
    }
    const step = (event.shiftKey ? 5 : 1) * KEY_STEP
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    const box = boxOf(overlay.id)
    if (!move || !box) return
    event.preventDefault()
    onChange(overlay.id, {
      x: clampCentre(box.centre.x / frame.w + move[0], box.w, frame.w, margin),
      y: clampCentre(box.centre.y / frame.h + move[1], box.h, frame.h, margin),
    })
  }

  const moving =
    draft !== null &&
    (draft.x !== undefined || draft.y !== undefined) &&
    gesture.current?.kind === "move"
  const selected = overlays.find((o) => o.id === selectedId)
  // 9:16 goes to TikTok / Reels: where their buttons sit (a hint; dragging there is fine)
  const platformGuide =
    interactive && format === "9:16" && (selected !== undefined || moving)

  return (
    <div
      ref={layerRef}
      data-testid="overlay-layer"
      className={cn(
        "absolute inset-0 overflow-hidden",
        // Only what's on it takes taps; the video under it plays / pauses
        "pointer-events-none",
      )}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerEnd(event)}
      onPointerCancel={(event) => onPointerEnd(event, true)}
    >
      {interactive && (selected || editingId) && (
        // The empty frame while something is selected: a tap deselects (instead of
        // playing), a second finger pinches the selected text
        <div
          ref={frameRef}
          data-testid="overlay-frame"
          className="pointer-events-auto absolute inset-0 touch-none"
          onPointerDown={onFrameDown}
        />
      )}
      {platformGuide && <PlatformGuide />}
      {guides.x && (
        <div
          data-testid="snap-guide-x"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-highlight"
        />
      )}
      {guides.y && (
        <div
          data-testid="snap-guide-y"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-highlight"
        />
      )}
      {frame.h > 0 &&
        overlays.map((overlay) => (
          <OverlayBox
            key={overlay.id}
            overlay={look(overlay)}
            frame={frame}
            margin={margin}
            remeasure={fontsLoaded}
            selected={interactive && overlay.id === selectedId}
            editing={interactive && overlay.id === editingId}
            interactive={interactive}
            boxRef={(element) => {
              if (element) boxes.current.set(overlay.id, element)
              else boxes.current.delete(overlay.id)
            }}
            onPointerDown={(event) => onBoxDown(event, overlay.id)}
            onResizeDown={(event) => onResizeDown(event, overlay.id)}
            onKeyDown={(event) => onBoxKey(event, overlay)}
            onFinishEdit={(text) => onFinishEdit(overlay.id, text)}
          />
        ))}
    </div>
  )
}

const clampSize = (size: number) =>
  Math.min(OVERLAY_SIZE.max, Math.max(OVERLAY_SIZE.min, size))

/**
 * Where TikTok and Instagram Reels put their buttons over a 9:16 video: the column on
 * the right and the caption area at the bottom. Faint, behind the text.
 */
function PlatformGuide() {
  return (
    <div
      data-testid="platform-guide"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <div className="absolute top-[38%] right-0 bottom-[20%] w-[14%] rounded-l-[6px] border border-court-foreground/45 border-r-0 border-dashed bg-court-foreground/12" />
      <div className="absolute inset-x-0 bottom-0 h-[20%] border-court-foreground/45 border-t border-dashed bg-court-foreground/12" />
      <span className="absolute bottom-1 left-1.5 text-[9px] font-bold text-court-foreground/80">
        TikTok / Reels buttons
      </span>
    </div>
  )
}

/**
 * One overlay on the video: the export's box (padding and corners in ems of its font
 * size), centred on (x, y) and kept inside the safe margin. Selected: a pink outline
 * with a corner handle to resize it.
 */
function OverlayBox({
  overlay,
  frame,
  margin,
  remeasure,
  selected,
  editing,
  interactive,
  boxRef,
  onPointerDown,
  onResizeDown,
  onKeyDown,
  onFinishEdit,
}: {
  overlay: Overlay
  frame: { w: number; h: number }
  margin: number
  /** Changes when the fonts have loaded: measure again. */
  remeasure: number
  selected: boolean
  editing: boolean
  interactive: boolean
  boxRef: (element: HTMLElement | null) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onResizeDown: (event: ReactPointerEvent<HTMLElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onFinishEdit: (text: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const fontPx = overlay.size * frame.h
  const maxWidth = Math.max(0, frame.w - 2 * margin)
  const [typed, setTyped] = useState(0)

  // Size the box like the export, then place it (before it's painted)
  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure and typed say when to measure again
  useLayoutEffect(() => {
    const element = ref.current
    const content = contentRef.current
    if (!element || !content) return
    // A wrapped box would be as wide as it may be: the export's is as wide as its
    // widest line. Measure the lines and shrink to that.
    element.style.width = ""
    if (!editing) {
      const widest = widestLine(content)
      if (widest > 0)
        element.style.width = `${Math.min(maxWidth, widest + 2 * BOX.padX * fontPx + 0.5)}px`
    }
    const w = element.offsetWidth
    const h = element.offsetHeight
    const left = placeBox(overlay.x * frame.w, w, frame.w, margin)
    const top = placeBox(overlay.y * frame.h, h, frame.h, margin)
    element.style.transform = `translate(${left}px, ${top}px)`
  }, [
    overlay.text,
    overlay.x,
    overlay.y,
    fontPx,
    maxWidth,
    frame.w,
    frame.h,
    margin,
    editing,
    remeasure,
    typed,
  ])

  const label = overlay.type === "text" ? `Text: ${overlay.text}` : "Overlay"
  return (
    // biome-ignore lint/a11y/useSemanticElements: it holds a text field while editing, which a <button> can't
    <div
      ref={(element) => {
        ref.current = element
        boxRef(element)
      }}
      data-testid="overlay"
      data-overlay-id={overlay.id}
      data-selected={selected || undefined}
      role="button"
      tabIndex={interactive && !editing ? 0 : -1}
      aria-label={label}
      aria-pressed={interactive ? selected : undefined}
      aria-keyshortcuts="Enter ArrowLeft ArrowRight ArrowUp ArrowDown"
      onPointerDown={onPointerDown}
      onKeyDown={editing ? undefined : onKeyDown}
      className={cn(
        // The export's box: ink at 75%, mint text, corners 0.5 em (caption_image.py)
        "absolute top-0 left-0 rounded-[0.5em] bg-court-ink/75 text-center font-extrabold font-overlay text-court-foreground outline-none",
        "[overflow-wrap:anywhere]",
        interactive
          ? "pointer-events-auto touch-none select-none focus-visible:ring-2 focus-visible:ring-ring"
          : "pointer-events-none",
        editing && "select-text",
      )}
      // Placed by the layout effect above, before the browser paints (never hidden:
      // a text being typed into must be focusable at once)
      style={{
        fontSize: fontPx,
        lineHeight: lineHeight("latin"),
        maxWidth,
        padding: `${BOX.padY - BOX.lineGap / 2}em ${BOX.padX}em`,
      }}
    >
      {editing && overlay.type === "text" ? (
        <TextEditor
          contentRef={contentRef}
          initial={overlay.text}
          onInput={() => setTyped((n) => n + 1)}
          onFinish={onFinishEdit}
        />
      ) : (
        <span ref={contentRef} data-testid="overlay-text">
          {renderContent(overlay)}
        </span>
      )}
      {selected && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[3px] rounded-[calc(0.5em+3px)] ring-2 ring-highlight"
          />
          {!editing && (
            // Drag the corner to resize (a 44 px target around a 14 px dot)
            <span
              data-testid="overlay-resize"
              aria-hidden="true"
              onPointerDown={onResizeDown}
              className="absolute -right-[22px] -bottom-[22px] flex size-11 touch-none items-center justify-center"
            >
              <span className="size-3.5 rounded-full bg-highlight ring-2 ring-court-foreground" />
            </span>
          )}
        </>
      )}
    </div>
  )
}

/** What an overlay shows, by type. A score overlay adds its renderer here. */
function renderContent(overlay: Overlay): ReactNode {
  switch (overlay.type) {
    case "text":
      return <TextContent text={overlay.text} />
  }
}

/**
 * The text, laid out to wrap like the export: lines break at spaces (CSS), Thai
 * between dictionary words (Intl.Segmenter: a <wbr> at each, which the browser's own
 * ICU breaking agrees with), a word wider than a line anywhere (`overflow-wrap:
 * anywhere` on the box, never `word-break: break-all`). Words are spans so the lines
 * can be measured without their trailing spaces (which the export doesn't count);
 * Thai runs get the Thai font's line height.
 */
function TextContent({ text }: { text: string }) {
  const pieces = linePieces(text)
  return pieces.map((piece, i) => {
    const word = piece.trimEnd()
    const space = piece.slice(word.length)
    const previous = pieces[i - 1]
    const thaiBoundary =
      previous !== undefined &&
      THAI.test(previous.slice(-1)) &&
      THAI.test(word.charAt(0))
    return (
      <Fragment key={i}>
        {thaiBoundary && <wbr />}
        <span data-word="">
          {fontRuns(word).map((run, k) =>
            run.thai ? (
              <span key={k} style={{ lineHeight: lineHeight("thai") }}>
                {run.text}
              </span>
            ) : (
              <Fragment key={k}>{run.text}</Fragment>
            ),
          )}
        </span>
        {space}
      </Fragment>
    )
  })
}

/** The widest line of the text in `content` (px), trailing spaces not counted. */
function widestLine(content: HTMLElement): number {
  const rects: DOMRect[] = []
  for (const word of content.querySelectorAll("[data-word]"))
    for (const rect of word.getClientRects())
      if (rect.width > 0) rects.push(rect)
  rects.sort((a, b) => a.top - b.top)
  // Rects whose middle is inside a line's height are on that line
  const lines: { top: number; bottom: number; left: number; right: number }[] =
    []
  for (const rect of rects) {
    const middle = (rect.top + rect.bottom) / 2
    const line = lines.find((l) => middle >= l.top && middle <= l.bottom)
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
    } else lines.push({ ...rect.toJSON() })
  }
  return Math.max(0, ...lines.map((line) => line.right - line.left))
}

/**
 * Typing into a text, inline on the video (the keyboard opens with it): one line of
 * plain text that wraps like the box, up to 80 characters. Enter or tapping elsewhere
 * keeps it, Escape cancels.
 */
function TextEditor({
  contentRef,
  initial,
  onInput,
  onFinish,
}: {
  contentRef: React.RefObject<HTMLSpanElement | null>
  initial: string
  onInput: () => void
  onFinish: (text: string | null) => void
}) {
  const done = useRef(false)
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    onFinish(text)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when editing starts
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    element.textContent = initial
    // Focus now, in the tap that asked for it: iOS only opens the keyboard then
    element.focus({ preventScroll: true })
    const selection = window.getSelection()
    if (selection) {
      selection.selectAllChildren(element)
      selection.collapseToEnd()
    }
    onInput()
  }, [])

  return (
    // biome-ignore lint/a11y/useSemanticElements: contenteditable, so the text wraps and sizes exactly like the box it becomes (an input or textarea can't)
    <span
      ref={contentRef}
      data-testid="overlay-editor"
      role="textbox"
      tabIndex={0}
      aria-label="Text"
      aria-multiline="false"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      enterKeyHint="done"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          finish(event.currentTarget.textContent ?? "")
        } else if (event.key === "Escape") {
          event.preventDefault()
          finish(null)
        }
      }}
      onInput={(event) => {
        const element = event.currentTarget
        const native = event.nativeEvent as InputEvent
        if (!native.isComposing) {
          const chars = [...(element.textContent ?? "").replace(/\n/g, " ")]
          if (chars.length > OVERLAY_TEXT_MAX) {
            element.textContent = chars.slice(0, OVERLAY_TEXT_MAX).join("")
            const selection = window.getSelection()
            selection?.selectAllChildren(element)
            selection?.collapseToEnd()
          }
        }
        // Emptied: no leftover <br>, so the placeholder shows
        if (!element.textContent) element.textContent = ""
        onInput()
      }}
      onBlur={(event) => finish(event.currentTarget.textContent ?? "")}
      className={cn(
        "inline-block min-w-[1ch] cursor-text whitespace-pre-wrap outline-none [caret-color:currentColor]",
        "empty:before:text-court-foreground/55 empty:before:content-['Your_text']",
      )}
      style={{
        // Thai in the text: room for its taller lines while typing
        lineHeight: lineHeight("latin"),
        minHeight: `${FONT_METRICS.latin.ascent + FONT_METRICS.latin.descent}em`,
      }}
    />
  )
}
