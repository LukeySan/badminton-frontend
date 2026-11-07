import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { AxiosError } from "axios"
import {
  Images,
  Play,
  RotateCcw,
  TriangleExclamationPoint,
  Undo2,
} from "lucide-react"
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { type CourtUpdate, type VideoPublic, VideosService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import {
  frameQueryOptions,
  ralliesQueryOptions,
  videoQueryOptions,
  videosQueryOptions,
} from "./queries"

// --- Geometry ---------------------------------------------------------------
// Corners are stored and sent as fractions of the video frame (0-1 inside it). The
// board is the frame plus a gray margin of COURT_MARGIN on every side, where corners
// that are cut off by the camera can still be tapped. Pixels are only used for
// reading pointer positions and sizing the magnifier.

/** Gray margin around the frame, as a fraction of its width/height (CLAUDE.md). */
const COURT_MARGIN = 0.3
const BOARD_SPAN = 1 + 2 * COURT_MARGIN // board size in frame widths/heights

const CORNER_NAMES = ["far-left", "far-right", "near-right", "near-left"]

type Point = [number, number]

/** Frame fraction → percent of the board (for CSS positioning). */
const toBoardPercent = (v: number) => ((v + COURT_MARGIN) / BOARD_SPAN) * 100
/** Fraction of the board (0-1) → frame fraction (-0.3 to 1.3). */
const fromBoardFraction = (f: number) => f * BOARD_SPAN - COURT_MARGIN
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

function sameCorners(a: Point[], b: Point[] | null): boolean {
  return (
    b !== null &&
    a.length === 4 &&
    b.length === 4 &&
    a.every(
      (p, i) =>
        Math.abs(p[0] - b[i][0]) < 1e-5 && Math.abs(p[1] - b[i][1]) < 1e-5,
    )
  )
}

/** A few moments to choose from, in case players hide a corner in the first one. */
function frameTimes(duration: number | null): number[] {
  if (!duration || duration < 10) return [1]
  return [1, 0.25, 0.5, 0.75].map((f, i) =>
    i === 0 ? f : Math.round(duration * f),
  )
}

// --- Error messages ---------------------------------------------------------

/**
 * Turns the backend's 422 into a sentence (and the corner it is about, if any).
 * The limits themselves stay in the backend: this only reads what it says.
 */
function courtError(error: Error): { message: string; corner?: number } {
  if (error instanceof AxiosError && error.response?.status === 422) {
    const first = error.response.data?.detail?.[0]
    if (first) {
      const [, field, index] = first.loc ?? []
      if (field === "corners" && typeof index === "number") {
        const outOfRange = /^(less|greater)_than/.test(first.type ?? "")
        return {
          corner: index,
          message: outOfRange
            ? `The ${CORNER_NAMES[index]} corner is too far outside the video. Drag it closer to the court.`
            : `${CORNER_NAMES[index]} corner: ${first.msg}`,
        }
      }
      const text = String(first.msg).replace(/^Value error, /, "")
      return { message: `${text.charAt(0).toUpperCase() + text.slice(1)}.` }
    }
  }
  return { message: extractErrorMessage(error) }
}

// --- Editor -------------------------------------------------------------------

export function CourtEditor({ video }: { video: VideoPublic }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Start from the saved court when re-marking (e.g. after a failed run).
  const [corners, setCorners] = useState<Point[]>(
    () => video.court_corners ?? [],
  )
  const times = useMemo(() => frameTimes(video.duration), [video.duration])
  const [timeIndex, setTimeIndex] = useState(0)
  const frame = useQuery({
    ...frameQueryOptions(video.id, times[timeIndex]),
    // Keep showing the current frame while "Another frame" loads.
    placeholderData: keepPreviousData,
  })
  const frameUrl = useObjectUrl(frame.data)

  const save = useMutation({
    mutationFn: async (corners: Point[]) =>
      (
        await VideosService.updateVideoCourt({
          path: { id: video.id },
          body: { corners: corners as CourtUpdate["corners"] },
        })
      ).data,
    onSuccess: (updated) => {
      queryClient.setQueryData(videoQueryOptions(video.id).queryKey, updated)
      queryClient.invalidateQueries({
        queryKey: videosQueryOptions().queryKey,
        exact: true,
      })
    },
  })

  const analyze = useMutation({
    mutationFn: async () =>
      (await VideosService.processVideo({ path: { id: video.id } })).data,
    onSuccess: (updated) => {
      queryClient.setQueryData(videoQueryOptions(video.id).queryKey, updated)
      queryClient.invalidateQueries({
        queryKey: videosQueryOptions().queryKey,
        exact: true,
      })
      // Reprocessing replaces the rallies; drop the old ones from the cache.
      queryClient.removeQueries({
        queryKey: ralliesQueryOptions(video.id).queryKey,
      })
      navigate({ to: "/videos/$id", params: { id: video.id } })
    },
  })

  const updateCorners = (next: Point[]) => {
    setCorners(next)
    save.reset() // an error about the old corners no longer applies
    analyze.reset()
  }

  // "Saved" = what's on screen is what the backend has. The out-of-frame warning is
  // computed by the backend for the saved court, so it's only shown in that case.
  const saved = sameCorners(corners, video.court_corners)
  const outOfFrame = saved && video.court_out_of_frame
  const error = save.isError ? courtError(save.error) : null
  const busy = save.isPending || analyze.isPending

  const onAnalyze = async () => {
    if (corners.length !== 4) return
    if (!saved) {
      let updated: VideoPublic
      try {
        updated = await save.mutateAsync(
          corners.map(([x, y]) => [round6(x), round6(y)]),
        )
      } catch {
        return // shown inline from save.error
      }
      // Part of the court is out of frame: let the user decide (warning below).
      if (updated.court_out_of_frame) return
    }
    analyze.mutate()
  }

  const next = corners.length

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center gap-3 rounded-lg border p-3"
        aria-live="polite"
      >
        <CourtDiagram next={next} />
        <div className="min-w-0">
          <p className="font-medium">
            {next < 4
              ? `Tap the ${CORNER_NAMES[next]} corner (${next + 1} of 4)`
              : "All four corners marked"}
          </p>
          <p className="text-sm text-muted-foreground">
            {next < 4
              ? "Far is the baseline at the top of the picture. If a corner is cut off, tap where it would be in the gray area."
              : "Drag a corner to adjust it, then analyze."}
          </p>
        </div>
      </div>

      {frame.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load a frame of this video</AlertTitle>
          <AlertDescription>
            <p>{extractErrorMessage(frame.error)}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => frame.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <CourtBoard
          aspect={
            video.width && video.height ? video.width / video.height : 16 / 9
          }
          frameUrl={frameUrl}
          corners={corners}
          onChange={updateCorners}
          errorCorner={error?.corner}
          disabled={busy}
        />
      )}
      <p className="text-sm text-muted-foreground sm:hidden">
        Tip: turn your phone sideways for a bigger picture.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateCorners(corners.slice(0, -1))}
          disabled={busy || corners.length === 0}
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateCorners([])}
          disabled={busy || corners.length === 0}
        >
          <RotateCcw />
          Reset
        </Button>
        {times.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeIndex((i) => (i + 1) % times.length)}
            disabled={frame.isFetching}
          >
            <Images />
            Another frame
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Check the corners</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {outOfFrame && (
        <Alert>
          <TriangleExclamationPoint />
          <AlertTitle>Part of your court is out of frame</AlertTitle>
          <AlertDescription>
            Results may be less accurate. You can analyze anyway, or adjust the
            corners if one was mis-tapped. Next time, record with the whole
            court in the picture.
          </AlertDescription>
        </Alert>
      )}
      {analyze.isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't start the analysis</AlertTitle>
          <AlertDescription>
            {extractErrorMessage(analyze.error)}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {video.status === "done" && (
          <p className="text-sm text-muted-foreground">
            Analyzing again replaces the current rallies.
          </p>
        )}
        <LoadingButton
          size="lg"
          className="w-full sm:w-auto"
          loading={busy}
          disabled={corners.length !== 4}
          onClick={onAnalyze}
        >
          {!busy && <Play />}
          {outOfFrame
            ? "Analyze anyway"
            : video.status === "done"
              ? "Analyze again"
              : "Analyze"}
        </LoadingButton>
      </div>
    </div>
  )
}

// --- Board: frame + margin, tap to place, drag to adjust -----------------------

type Drag = { index: number; pointerId: number; touch: boolean; offset: Point }

function CourtBoard({
  aspect,
  frameUrl,
  corners,
  onChange,
  errorCorner,
  disabled,
}: {
  aspect: number
  frameUrl: string | undefined
  corners: Point[]
  onChange: (corners: Point[]) => void
  errorCorner?: number
  disabled: boolean
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [boardWidth, setBoardWidth] = useState(0)

  // Pointer position → frame fraction, kept inside the board.
  const pointAt = (event: ReactPointerEvent): Point => {
    const rect = boardRef.current!.getBoundingClientRect()
    return [
      fromBoardFraction(clamp((event.clientX - rect.left) / rect.width, 0, 1)),
      fromBoardFraction(clamp((event.clientY - rect.top) / rect.height, 0, 1)),
    ]
  }

  // Pointer events cover mouse, touch and pen with one code path. Pressing on the
  // empty board places the next corner *and* starts dragging it, so on a phone you
  // can press, slide to the exact spot with the magnifier, and let go.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || drag) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-corner]",
    )
    const point = pointAt(event)
    let index: number
    let offset: Point = [0, 0]
    if (handle) {
      index = Number(handle.dataset.corner)
      // Keep the grab offset so the corner doesn't jump under the finger.
      offset = [corners[index][0] - point[0], corners[index][1] - point[1]]
    } else if (corners.length < 4) {
      index = corners.length
      onChange([...corners, point])
    } else {
      return
    }
    event.preventDefault()
    // Capture: keep receiving moves even if the pointer leaves the board.
    boardRef.current!.setPointerCapture(event.pointerId)
    setBoardWidth(boardRef.current!.getBoundingClientRect().width)
    setDrag({
      index,
      pointerId: event.pointerId,
      touch: event.pointerType !== "mouse",
      offset,
    })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const [x, y] = pointAt(event)
    const moved: Point = [
      clamp(x + drag.offset[0], -COURT_MARGIN, 1 + COURT_MARGIN),
      clamp(y + drag.offset[1], -COURT_MARGIN, 1 + COURT_MARGIN),
    ]
    onChange(corners.map((c, i) => (i === drag.index ? moved : c)))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && event.pointerId === drag.pointerId) setDrag(null)
  }

  const frameBox = {
    left: `${toBoardPercent(0)}%`,
    top: `${toBoardPercent(0)}%`,
    width: `${100 / BOARD_SPAN}%`,
    height: `${100 / BOARD_SPAN}%`,
  }
  const svgPoints = corners
    .map(([x, y]) => `${toBoardPercent(x)},${toBoardPercent(y)}`)
    .join(" ")

  return (
    <div
      ref={boardRef}
      role="application"
      aria-label="Video frame with a gray margin. Tap the four court corners in order."
      data-testid="court-board"
      className={cn(
        // touch-none: the browser must not scroll or zoom while placing corners.
        "relative mx-auto touch-none select-none rounded-lg bg-muted [-webkit-touch-callout:none]",
        corners.length < 4 && !disabled ? "cursor-crosshair" : "",
      )}
      // Full width, but never taller than 75% of the screen (portrait videos, phones
      // held sideways): narrowing the width keeps the frame's shape, which max-height
      // alone would not.
      style={{
        aspectRatio: aspect,
        width: `min(100%, calc(75vh * ${aspect}))`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="pointer-events-none absolute left-2 top-1 text-[10px] text-muted-foreground sm:text-xs">
        Outside the video
      </span>
      {frameUrl ? (
        <img
          src={frameUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute"
          style={frameBox}
        />
      ) : (
        <Skeleton className="absolute rounded-none" style={frameBox} />
      )}
      <div
        className="pointer-events-none absolute ring-1 ring-foreground/40"
        style={frameBox}
      />

      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {corners.length === 4 ? (
          <polygon
            points={svgPoints}
            className="fill-primary/20 stroke-primary"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          corners.length > 1 && (
            <polyline
              points={svgPoints}
              className="fill-none stroke-primary"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )
        )}
      </svg>

      {corners.map(([x, y], index) => (
        // 44px hit area (touch target size) around a small visible dot.
        <div
          key={CORNER_NAMES[index]}
          data-corner={index}
          data-testid={`corner-${index}`}
          className={cn(
            "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
            disabled
              ? ""
              : drag?.index === index
                ? "cursor-grabbing"
                : "cursor-grab",
          )}
          style={{
            left: `${toBoardPercent(x)}%`,
            top: `${toBoardPercent(y)}%`,
          }}
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md",
              index === errorCorner ? "bg-destructive" : "bg-primary",
            )}
          >
            {index + 1}
          </span>
        </div>
      ))}

      {drag?.touch && frameUrl && corners[drag.index] && (
        <Magnifier
          point={corners[drag.index]}
          frameUrl={frameUrl}
          boardWidth={boardWidth}
          aspect={aspect}
        />
      )}
    </div>
  )
}

/** Zoomed view above the finger while dragging on a touch screen (the finger hides
 *  the spot being placed). */
function Magnifier({
  point,
  frameUrl,
  boardWidth,
  aspect,
}: {
  point: Point
  frameUrl: string
  boardWidth: number
  aspect: number
}) {
  const SIZE = 112
  const ZOOM = 3
  const frameWidth = boardWidth / BOARD_SPAN
  const frameHeight = frameWidth / aspect
  const top = toBoardPercent(point[1])
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-full border-2 border-white bg-muted bg-no-repeat shadow-lg"
      style={{
        width: SIZE,
        height: SIZE,
        // Stay inside the board horizontally (no page overflow on phones).
        left: `clamp(${SIZE / 2}px, ${toBoardPercent(point[0])}%, calc(100% - ${SIZE / 2}px))`,
        top: `${top}%`,
        // Above the finger, or below it near the top of the board.
        transform: `translate(-50%, ${top > 35 ? "calc(-100% - 32px)" : "32px"})`,
        backgroundImage: `url(${frameUrl})`,
        backgroundSize: `${ZOOM * frameWidth}px ${ZOOM * frameHeight}px`,
        backgroundPosition: `${SIZE / 2 - ZOOM * point[0] * frameWidth}px ${SIZE / 2 - ZOOM * point[1] * frameHeight}px`,
      }}
      data-testid="magnifier"
    >
      <div className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary" />
    </div>
  )
}

/** Small court sketch showing which corner is next. */
function CourtDiagram({ next }: { next: number }) {
  const dots: Point[] = [
    [16, 6],
    [40, 6],
    [52, 34],
    [4, 34],
  ]
  return (
    <svg viewBox="0 0 56 40" className="h-10 w-14 shrink-0" aria-hidden="true">
      <polygon
        points="16,6 40,6 52,34 4,34"
        className="fill-none stroke-muted-foreground"
        strokeWidth={1.5}
      />
      <line
        x1={10}
        y1={20}
        x2={46}
        y2={20}
        className="stroke-muted-foreground"
        strokeDasharray="2 2"
      />
      {dots.map(([cx, cy], i) => (
        <circle
          key={CORNER_NAMES[i]}
          cx={cx}
          cy={cy}
          r={i === next ? 5 : 3.5}
          className={cn(
            i < next && "fill-primary",
            i === next && "animate-pulse fill-primary",
            i > next && "fill-muted-foreground/50",
          )}
        />
      ))}
    </svg>
  )
}

/** Blob → object URL for <img>, released again when it changes or unmounts. */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return url
}
