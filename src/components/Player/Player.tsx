import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Check,
  ChevronLeft,
  EllipsisVertical,
  MapPin,
  TriangleExclamationPoint,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

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
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='dialog']",
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

  // --- Full screen ---------------------------------------------------------------
  // The video box (with the rally badge and skip pill) goes full screen. iPhone
  // Safari only allows the bare <video>, so fall back to that.
  const videoBoxRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === videoBoxRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
      return
    }
    const box = videoBoxRef.current
    if (box?.requestFullscreen) {
      box.requestFullscreen().catch(() => {})
    } else {
      const element = videoRef.current as
        | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
        | null
      element?.webkitEnterFullscreen?.()
    }
  }

  const aspect =
    video.width && video.height ? video.width / video.height : 16 / 9
  // Stats over all rallies (not the filter): what the recording contains.
  const playTime = rallyTime(allSegments)
  const visibleNumbers = useMemo(
    () => new Set(segments.map((s) => s.number)),
    [segments],
  )
  const longest = Math.max(0, ...allSegments.map((s) => s.rally.duration))

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
      <PlayerHeader video={video} rallyCount={rallies.data?.count} />

      <div className="flex min-h-0 flex-1 flex-col md:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex shrink-0 flex-col">
          {/* Light phones: inset card; dark phones: edge to edge (mockups) */}
          <div className="max-md:px-3 max-md:dark:px-0">
            <div
              ref={videoBoxRef}
              className="relative mx-auto overflow-hidden rounded-xl bg-court max-md:dark:rounded-none [&:fullscreen]:rounded-none"
              // Never taller than 70% of the screen (phones held sideways)
              style={{
                aspectRatio: aspect,
                width: `min(100%, calc(70dvh * ${aspect}))`,
              }}
            >
              {src ? (
                // biome-ignore lint/a11y/useMediaCaption: match footage has no captions
                <video
                  ref={videoRef}
                  src={src}
                  playsInline
                  preload="metadata"
                  className="size-full"
                  data-testid="video"
                  onClick={togglePlay}
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

              {/* Rally badge (top-left): pink = the rally being watched */}
              {current && (
                <div
                  data-testid="current-rally"
                  className="pointer-events-none absolute top-3 left-3 rounded-[8px] bg-highlight px-2.5 py-1 text-[13px] font-extrabold text-highlight-foreground tabular-nums"
                >
                  Rally {current.number} of {allSegments.length}
                </div>
              )}

              {/* Skip-breaks pill (bottom-right): a playback setting, like "Skip intro" */}
              <button
                type="button"
                role="switch"
                aria-checked={skipBreaks}
                aria-label="Skip breaks"
                title="Play only the rallies"
                onClick={() => setSkipBreaks((on) => !on)}
                className="group absolute right-1.5 bottom-1 flex h-11 items-center px-1.5 outline-none"
              >
                <span
                  className={cn(
                    "flex h-[30px] items-center gap-[5px] whitespace-nowrap rounded-full px-3 text-xs group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    skipBreaks
                      ? "bg-chapter font-extrabold text-chapter-foreground"
                      : "border border-court-foreground/35 bg-court-ink/80 font-bold text-court-foreground",
                  )}
                >
                  {skipBreaks && <Check className="size-3.5" strokeWidth={3} />}
                  {skipBreaks ? "Skipping breaks" : "Skip breaks"}
                </span>
              </button>

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
          </div>

          <div className="px-4 pt-1.5 md:px-0">
            <RallyScrubber
              duration={duration}
              time={time}
              segments={allSegments}
              visibleNumbers={visibleNumbers}
              currentNumber={current?.number}
              onSeek={seek}
              onScrubbingChange={setScrubbing}
            />
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center pr-1.5 pb-2 pl-4 md:px-0">
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
                onClick={goPrevious}
                disabled={!src || segments.length === 0}
              >
                <PreviousRallyIcon className="size-5" />
              </ControlButton>
              <ControlButton
                label={paused ? "Play" : "Pause"}
                title={paused ? "Play (space)" : "Pause (space)"}
                onClick={togglePlay}
                disabled={!src}
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
                onClick={goNext}
                disabled={!src || segments.length === 0}
              >
                <NextRallyIcon className="size-5" />
              </ControlButton>
            </div>
            <div className="flex justify-end">
              <ControlButton
                label={fullscreen ? "Exit full screen" : "Full screen"}
                onClick={toggleFullscreen}
                disabled={!src}
              >
                {fullscreen ? (
                  <ExitFullscreenIcon className="size-5" />
                ) : (
                  <FullscreenIcon className="size-5" />
                )}
              </ControlButton>
            </div>
          </div>
        </div>

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
function PlayerHeader({
  video,
  rallyCount,
}: {
  video: VideoPublic
  rallyCount: number | undefined
}) {
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
          {formatDuration(video.duration)}
          {rallyCount !== undefined && ` · ${rallyCount} rallies`}
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
        </DropdownMenuContent>
      </DropdownMenu>
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
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
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
