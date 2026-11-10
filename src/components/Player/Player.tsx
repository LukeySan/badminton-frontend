import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Check,
  ChevronLeft,
  EllipsisVertical,
  MapPin,
  Trash2,
  TriangleExclamationPoint,
} from "lucide-react"
import {
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import type { VideoPublic } from "@/client"
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  NextRallyIcon,
  PauseIcon,
  PlayIcon,
  PreviousRallyIcon,
} from "@/components/Common/AppIcons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { DeleteVideoDialog } from "@/components/Videos/DeleteVideo"
import {
  fileUrlQueryOptions,
  ralliesQueryOptions,
} from "@/components/Videos/queries"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import { RallyList, type RallySort } from "./RallyList"
import { RallyScrubber } from "./RallyScrubber"
import {
  nextSegment,
  previousSegment,
  rallyTime,
  type Segment,
  segmentAt,
  skipTarget,
  toSegments,
} from "./rallies"
import { useFullscreenPlayer } from "./useFullscreenPlayer"

// Same base as the API client (src/main.tsx); file-url returns a path.
const API_URL = import.meta.env.VITE_API_URL ?? ""

export function Player({ video }: { video: VideoPublic }) {
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const fileUrl = useQuery(fileUrlQueryOptions(video.id))
  const videoRef = useRef<HTMLVideoElement>(null)

  // Mirrors of the <video> element's state, updated from its events.
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)

  const [skipBreaks, setSkipBreaks] = useState(false)
  const [sort, setSort] = useState<RallySort>("time")
  const [minLength, setMinLength] = useState(0)

  // Rally times come from the API's timeline, so its duration is the reference.
  const duration = video.duration || mediaDuration
  const allSegments = useMemo(
    () => toSegments(rallies.data?.data ?? [], duration),
    [rallies.data, duration],
  )
  // Filtering applies everywhere: scrubber, list, previous/next and skip-breaks.
  const segments = useMemo(
    () => allSegments.filter((s) => s.rally.duration >= minLength),
    [allSegments, minLength],
  )
  const current = segmentAt(segments, time)

  // --- Signed video URL -------------------------------------------------------
  // When the link is renewed (expiry, or after a playback error) the <video> loads
  // the new URL from scratch; put the viewer back where they were.
  const [src, setSrc] = useState<string>()
  const hasLoadedUrl = useRef(false)
  const lastTime = useRef(0)
  const wasPlaying = useRef(false)
  const resume = useRef<{ time: number; play: boolean } | null>(null)
  const retriedError = useRef(false)
  const url = fileUrl.data?.url

  useEffect(() => {
    if (!url) return
    if (hasLoadedUrl.current && !resume.current) {
      resume.current = { time: lastTime.current, play: wasPlaying.current }
    }
    hasLoadedUrl.current = true
    setSrc(`${API_URL}${url}`)
  }, [url])

  const onLoadedMetadata = () => {
    const element = videoRef.current!
    setMediaDuration(element.duration)
    if (resume.current) {
      element.currentTime = resume.current.time
      if (resume.current.play) element.play().catch(() => {})
      resume.current = null
    }
  }

  const onError = () => {
    // An expired link fails as a network/source error. Get a fresh link once.
    if (!retriedError.current) {
      retriedError.current = true
      resume.current = { time: lastTime.current, play: wasPlaying.current }
      fileUrl.refetch()
    } else {
      setPlaybackError(true)
    }
  }

  // --- Playback actions -------------------------------------------------------
  const seek = (t: number) => {
    const element = videoRef.current
    if (!element) return
    const clamped = Math.min(
      Math.max(0, t),
      duration || Number.POSITIVE_INFINITY,
    )
    element.currentTime = clamped
    lastTime.current = clamped
    setTime(clamped)
  }

  const play = () => videoRef.current?.play().catch(() => {})
  const togglePlay = () => {
    const element = videoRef.current
    if (!element) return
    if (element.paused) play()
    else element.pause()
  }

  /** Jump to a rally (with its padding) and play it. */
  const playSegment = (segment: Segment | undefined) => {
    if (!segment) return
    seek(segment.start)
    play()
  }

  // Read the time from the element, not state: state lags up to one timeupdate.
  const goNext = () =>
    playSegment(nextSegment(segments, videoRef.current?.currentTime ?? time))
  const goPrevious = () =>
    playSegment(
      previousSegment(segments, videoRef.current?.currentTime ?? time),
    )

  /** Skip-breaks: when playback is outside every rally, jump to the next one. */
  const enforceSkipBreaks = (t: number) => {
    const element = videoRef.current
    if (!skipBreaks || scrubbing || !element || element.paused) return
    const target = skipTarget(segments, t)
    if (target === undefined) return
    if (target === null) element.pause()
    else seek(target)
  }

  // --- Keyboard: space = play/pause, ←/→ = previous/next rally -----------------
  // On the window so it works without clicking the player first. Ignored while
  // typing or inside menus/dialogs; the scrubber handles its own arrow keys.
  const keyActions = useRef({ togglePlay, goNext, goPrevious })
  useEffect(() => {
    keyActions.current = { togglePlay, goNext, goPrevious }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const target = event.target as HTMLElement
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='dialog']:not([data-player-fullscreen])",
        )
      )
        return
      const onSlider = target.closest("[role='slider']") !== null
      if (event.key === " ") {
        event.preventDefault() // no page scroll, and no "click" on a focused button
        keyActions.current.togglePlay()
      } else if (event.key === "ArrowRight" && !onSlider) {
        event.preventDefault()
        keyActions.current.goNext()
      } else if (event.key === "ArrowLeft" && !onSlider) {
        event.preventDefault()
        keyActions.current.goPrevious()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const aspect =
    video.width && video.height ? video.width / video.height : 16 / 9

  // --- Full screen: our own layer, never the browser's video player ------------------
  const fullscreen = useFullscreenPlayer({ landscape: aspect >= 1 })
  // Inline the controls are always shown; in full screen they fade during playback.
  const showControls =
    !fullscreen.active || fullscreen.controlsAwake || paused || scrubbing

  // ONE <video> for both modes. React renders the video frame into `videoHost`, a DOM
  // node made once, and that node is moved between the inline slot and the
  // full-screen slot. Moving a playing <video> keeps it playing (browsers only pause
  // it if it's still out of the document after the current task), so entering or
  // leaving full screen never reloads the file, loses the position, or asks for a
  // new signed URL.
  const [videoHost] = useState(() => {
    const host = document.createElement("div")
    host.className = "absolute inset-0"
    return host
  })
  const inlineSlotRef = useRef<HTMLDivElement>(null)
  const fullscreenSlotRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const slot = fullscreen.active
      ? fullscreenSlotRef.current
      : inlineSlotRef.current
    if (slot && videoHost.parentNode !== slot) slot.appendChild(videoHost)
  }, [fullscreen.active, videoHost])
  useLayoutEffect(() => () => videoHost.remove(), [videoHost])

  // Stats over all rallies (not the filter): what the recording contains.
  const playTime = rallyTime(allSegments)
  const visibleNumbers = useMemo(
    () => new Set(segments.map((s) => s.number)),
    [segments],
  )
  const longest = Math.max(0, ...allSegments.map((s) => s.rally.duration))

  // --- Pieces shown in both modes: same state, same handlers ------------------------
  const title = video.filename.replace(/\.[^.]+$/, "")
  const toggleSkipBreaks = () => setSkipBreaks((on) => !on)
  const rallyBadge = current && (
    <RallyBadge number={current.number} total={allSegments.length} />
  )
  const scrubber = (
    <RallyScrubber
      duration={duration}
      time={time}
      segments={allSegments}
      visibleNumbers={visibleNumbers}
      currentNumber={current?.number}
      onSeek={seek}
      onScrubbingChange={setScrubbing}
    />
  )
  const controlRowProps = {
    time,
    duration,
    paused,
    canPlay: Boolean(src),
    canNavigate: Boolean(src) && segments.length > 0,
    onPrevious: goPrevious,
    onTogglePlay: togglePlay,
    onNext: goNext,
  }

  // The video frame: rendered into videoHost, so it moves between the modes. Overlays
  // that must line up with the picture (and the future trail / caption overlays) go
  // here: the frame always has the video's exact shape.
  const frame = (
    <div className="relative size-full">
      {src ? (
        // biome-ignore lint/a11y/useMediaCaption: match footage has no captions
        <video
          ref={videoRef}
          src={src}
          // Inline playback, no native controls: iOS must never switch to its own
          // full-screen player (CLAUDE.md).
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          className="size-full"
          data-testid="video"
          onClick={() => {
            // Full screen with the controls hidden: the first tap only shows them.
            if (!showControls) return fullscreen.wakeControls()
            togglePlay()
            if (fullscreen.active) fullscreen.wakeControls()
          }}
          onLoadedMetadata={onLoadedMetadata}
          onLoadedData={() => {
            retriedError.current = false
            setPlaybackError(false)
          }}
          onTimeUpdate={(event) => {
            const t = event.currentTarget.currentTime
            lastTime.current = t
            setTime(t)
            enforceSkipBreaks(t)
          }}
          onSeeked={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={(event) => {
            wasPlaying.current = true
            setPaused(false)
            enforceSkipBreaks(event.currentTarget.currentTime)
          }}
          onPause={() => {
            wasPlaying.current = false
            setPaused(true)
          }}
          onEnded={() => setPaused(true)}
          onError={onError}
        />
      ) : fileUrl.isError ? (
        <PlayerMessage
          text={`Couldn't get the video link: ${extractErrorMessage(fileUrl.error)}`}
          onRetry={() => fileUrl.refetch()}
        />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}

      {/* Inline: rally badge top-left, skip pill bottom-right ("Skip intro" style).
          In full screen they sit in the layer, clear of the notch. */}
      {!fullscreen.active && rallyBadge && (
        <div className="pointer-events-none absolute top-3 left-3">
          {rallyBadge}
        </div>
      )}
      {!fullscreen.active && (
        <SkipBreaksPill
          on={skipBreaks}
          onToggle={toggleSkipBreaks}
          className="absolute right-1.5 bottom-1"
        />
      )}

      {playbackError && (
        <PlayerMessage
          text="This video can't be played right now."
          onRetry={() => {
            setPlaybackError(false)
            retriedError.current = false
            resume.current = {
              time: lastTime.current,
              play: wasPlaying.current,
            }
            fileUrl.refetch()
          }}
        />
      )}
    </div>
  )

  return (
    <div
      className={cn(
        "flex flex-col",
        // Phones held upright: a full-screen view like the mockup. Header, video and
        // controls stay put; only the rally sheet scrolls. (-m-4 undoes the page
        // padding; landscape phones and bigger screens scroll normally.)
        "max-md:portrait:-m-4 max-md:portrait:h-dvh",
      )}
    >
      {createPortal(frame, videoHost)}

      <PlayerHeader video={video} />

      <div className="flex min-h-0 flex-1 flex-col md:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex shrink-0 flex-col">
          {/* Light phones: inset card; dark phones: edge to edge (mockups) */}
          <div className="max-md:px-3 max-md:dark:px-0">
            {/* Inline slot: keeps its size while the frame is in full screen, so the
                page behind doesn't jump */}
            <div
              ref={inlineSlotRef}
              className="relative mx-auto overflow-hidden rounded-xl bg-court max-md:dark:rounded-none"
              // Never taller than 70% of the screen
              style={{
                aspectRatio: aspect,
                width: `min(100%, calc(70dvh * ${aspect}))`,
              }}
            />
          </div>

          {/* Hidden (not removed) in full screen: the layout behind stays put */}
          <div
            className={cn(
              "px-4 pt-1.5 md:px-0",
              fullscreen.active && "invisible",
            )}
          >
            {scrubber}
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-2 px-4 pt-1 pb-3 md:px-0">
            <Stat
              label="This rally"
              value={current ? `${current.rally.duration.toFixed(1)}s` : "–"}
            />
            <Stat
              label="Actual play"
              value={formatDuration(playTime)}
              valueClassName="text-success-text"
            />
            <Stat
              label="Breaks cut"
              value={formatDuration(Math.max(0, duration - playTime))}
            />
          </div>

          {/* Control row (TikTok style): time left, rally controls centered, full screen right */}
          <ControlRow
            {...controlRowProps}
            className={cn(
              "pr-1.5 pb-2 pl-4 md:px-0",
              fullscreen.active && "invisible",
            )}
            trailing={
              <ControlButton
                ref={fullscreen.triggerRef}
                label="Full screen"
                onClick={fullscreen.enter}
                disabled={!src}
              >
                <FullscreenIcon className="size-5" />
              </ControlButton>
            }
          />
        </div>

        {fullscreen.active &&
          createPortal(
            <div
              ref={fullscreen.layerRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${title}, full screen`}
              data-player-fullscreen=""
              data-testid="player-fullscreen"
              tabIndex={-1}
              // Video players are dark in both themes: `dark` re-points the tokens.
              className={cn(
                "dark fixed inset-0 z-[200] overflow-hidden bg-letterbox text-foreground outline-none",
                !showControls && "cursor-none",
              )}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") fullscreen.wakeControls()
              }}
              onKeyDown={fullscreen.wakeControls}
              // A tap on the black bars shows or hides the controls.
              onClick={(event) => {
                if (
                  event.target !== event.currentTarget &&
                  event.target !== fullscreenSlotRef.current
                )
                  return
                if (showControls) fullscreen.hideControls()
                else fullscreen.wakeControls()
              }}
            >
              {/* The video, as big as fits, keeping its shape */}
              <div
                ref={fullscreenSlotRef}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{
                  aspectRatio: aspect,
                  width: `min(100vw, calc(100dvh * ${aspect}))`,
                }}
              />

              {/* Top: gradient + skip pill (fades with the controls) */}
              <div
                inert={!showControls}
                onPointerDownCapture={fullscreen.wakeControls}
                className={cn(
                  "absolute inset-x-0 top-0 flex justify-end bg-linear-to-b from-letterbox/75 via-letterbox/35 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-10 pl-[max(1rem,env(safe-area-inset-left))] transition-opacity duration-300",
                  showControls ? "opacity-100" : "opacity-0",
                )}
              >
                <SkipBreaksPill on={skipBreaks} onToggle={toggleSkipBreaks} />
              </div>
              {/* Rally badge stays while watching: it says what you're looking at */}
              {rallyBadge && (
                <div className="pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] flex h-11 items-center">
                  {rallyBadge}
                </div>
              )}

              {/* Bottom: gradient + chapter bar + the same control row, exit at the end */}
              <div
                inert={!showControls}
                onPointerDownCapture={fullscreen.wakeControls}
                className={cn(
                  "absolute inset-x-0 bottom-0 bg-linear-to-t from-letterbox/90 via-letterbox/60 to-transparent pt-12 pr-[max(0.375rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] transition-opacity duration-300",
                  showControls ? "opacity-100" : "opacity-0",
                )}
              >
                <div className="pr-2.5">{scrubber}</div>
                <ControlRow
                  {...controlRowProps}
                  trailing={
                    <ControlButton
                      label="Exit full screen"
                      title="Exit full screen (Esc)"
                      onClick={fullscreen.exit}
                    >
                      <ExitFullscreenIcon className="size-5" />
                    </ControlButton>
                  }
                />
              </div>
            </div>,
            document.body,
          )}

        {rallies.isPending ? (
          <Skeleton className="h-64 w-full rounded-t-[22px] max-md:portrait:flex-1 md:rounded-[22px]" />
        ) : rallies.isError ? (
          <Alert variant="destructive" className="max-md:mx-4">
            <AlertTitle>Couldn't load the rallies</AlertTitle>
            <AlertDescription>
              <p>{extractErrorMessage(rallies.error)}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => rallies.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <RallyList
            segments={segments}
            totalCount={allSegments.length}
            longest={longest}
            currentNumber={current?.number}
            sort={sort}
            onSortChange={setSort}
            minLength={minLength}
            onMinLengthChange={setMinLength}
            onSelect={playSegment}
            className={cn(
              // Phone: bottom sheet filling the rest of the screen
              "max-md:portrait:flex-1",
              // Wider: a card; side panel as tall as the window on desktop
              "md:rounded-[22px] lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)]",
            )}
          >
            {video.court_out_of_frame && (
              <Alert className="mx-4 mb-2 w-auto px-3 py-2">
                <TriangleExclamationPoint />
                <AlertTitle>Part of your court was out of frame</AlertTitle>
                <AlertDescription>
                  <p>
                    Some rallies may be missed or cut short.{" "}
                    <Link
                      to="/videos/$id/court"
                      params={{ id: video.id }}
                      className="underline underline-offset-4"
                    >
                      Re-mark the court
                    </Link>{" "}
                    if a corner was mis-tapped.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </RallyList>
        )}
      </div>
    </div>
  )
}

/** Back, title + "21:24 · 73 rallies", and a menu (DESIGN.md player header). */
function PlayerHeader({ video }: { video: VideoPublic }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 py-2 pr-2 pl-1 md:mb-4 md:h-auto md:p-0">
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-md md:-ml-3"
      >
        <Link to="/" aria-label="Back to videos">
          <ChevronLeft className="size-[22px]" />
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-[15px] font-extrabold md:text-[26px] md:tracking-[-0.01em]">
          {video.filename.replace(/\.[^.]+$/, "")}
        </h1>
        <p className="text-xs text-muted-foreground tabular-nums md:text-[13px]">
          {formatDuration(video.duration)} · {video.rally_count}{" "}
          {video.rally_count === 1 ? "rally" : "rallies"}
        </p>
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-md text-muted-foreground"
            aria-label="More options"
          >
            <EllipsisVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/videos/$id/court" params={{ id: video.id }}>
              <MapPin />
              Re-mark court
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleting(true)}
          >
            <Trash2 />
            Delete video
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteVideoDialog
        video={video}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </header>
  )
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-card px-2.5 py-2">
      <span className="truncate text-[11px] font-bold text-muted-foreground">
        {label}
      </span>
      <span
        className={cn("text-xl font-extrabold tabular-nums", valueClassName)}
      >
        {value}
      </span>
    </div>
  )
}

/** Plain icon button in a 44×44 target, no background (DESIGN.md control row). */
function ControlButton({
  ref,
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  ref?: Ref<HTMLButtonElement>
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className="size-11 rounded-xl text-foreground hover:bg-secondary/60"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

function PlayerMessage({
  text,
  onRetry,
}: {
  text: string
  onRetry: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-court/90 p-4 text-center text-sm text-court-foreground">
      <p>{text}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function SkipBreaksPill({
  on,
  onToggle,
  className,
}: {
  on: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Skip breaks"
      title="Play only the rallies"
      onClick={onToggle}
      // 44 px tall target around the 30 px pill
      className={cn(
        "group flex h-11 items-center px-1.5 outline-none",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-[30px] items-center gap-[5px] whitespace-nowrap rounded-full px-3 text-xs group-focus-visible:ring-2 group-focus-visible:ring-ring",
          on
            ? "bg-chapter font-extrabold text-chapter-foreground"
            : "border border-court-foreground/35 bg-court-ink/80 font-bold text-court-foreground",
        )}
      >
        {on && <Check className="size-3.5" strokeWidth={3} />}
        {on ? "Skipping breaks" : "Skip breaks"}
      </span>
    </button>
  )
}

/** Pink "Rally 12 of 73": the rally being watched (pink = look here, DESIGN.md). */
function RallyBadge({ number, total }: { number: number; total: number }) {
  return (
    <span
      data-testid="current-rally"
      className="rounded-[8px] bg-highlight px-2.5 py-1 text-[13px] font-extrabold text-highlight-foreground tabular-nums"
    >
      Rally {number} of {total}
    </span>
  )
}

/**
 * Time, previous / play-pause / next, and one trailing button (Full screen inline,
 * Exit in full screen). The same component and handlers in both modes.
 */
function ControlRow({
  time,
  duration,
  paused,
  canPlay,
  canNavigate,
  onPrevious,
  onTogglePlay,
  onNext,
  trailing,
  className,
}: {
  time: number
  duration: number
  paused: boolean
  canPlay: boolean
  canNavigate: boolean
  onPrevious: () => void
  onTogglePlay: () => void
  onNext: () => void
  trailing: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center",
        className,
      )}
    >
      <span className="whitespace-nowrap text-[13px] tabular-nums">
        {formatDuration(time)}
        <span className="text-muted-foreground">
          {" "}
          / {formatDuration(duration)}
        </span>
      </span>
      <div className="flex items-center">
        <ControlButton
          label="Previous rally"
          title="Previous rally (←)"
          onClick={onPrevious}
          disabled={!canNavigate}
        >
          <PreviousRallyIcon className="size-5" />
        </ControlButton>
        <ControlButton
          label={paused ? "Play" : "Pause"}
          title={paused ? "Play (space)" : "Pause (space)"}
          onClick={onTogglePlay}
          disabled={!canPlay}
        >
          {paused ? (
            <PlayIcon className="size-[26px]" />
          ) : (
            <PauseIcon className="size-[26px]" />
          )}
        </ControlButton>
        <ControlButton
          label="Next rally"
          title="Next rally (→)"
          onClick={onNext}
          disabled={!canNavigate}
        >
          <NextRallyIcon className="size-5" />
        </ControlButton>
      </div>
      <div className="flex justify-end">{trailing}</div>
    </div>
  )
}
