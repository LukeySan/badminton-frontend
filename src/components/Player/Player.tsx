import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  FastForward,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  TriangleExclamationPoint,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { VideoPublic } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

  const aspect =
    video.width && video.height ? video.width / video.height : 16 / 9

  return (
    <div className="flex flex-col gap-4">
      {video.court_out_of_frame && (
        <Alert>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        {/* On phones held upright the player sticks under the header while the
            rally list scrolls beneath it. */}
        <div
          className={cn(
            "flex flex-col gap-1 bg-background",
            "portrait:max-lg:sticky portrait:max-lg:top-16 portrait:max-lg:z-10 portrait:max-lg:-mx-4 portrait:max-lg:px-4 portrait:max-lg:pb-2 portrait:max-lg:pt-2 sm:portrait:max-lg:-mx-6 sm:portrait:max-lg:px-6",
          )}
        >
          <div
            className="relative w-full overflow-hidden rounded-lg bg-black"
            style={{ aspectRatio: aspect }}
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

          <RallyScrubber
            duration={duration}
            time={time}
            segments={segments}
            currentNumber={current?.number}
            onSeek={seek}
            onScrubbingChange={setScrubbing}
          />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              disabled={!src}
              aria-label={paused ? "Play" : "Pause"}
              title={paused ? "Play (space)" : "Pause (space)"}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goPrevious}
              disabled={!src || segments.length === 0}
              aria-label="Previous rally"
              title="Previous rally (←)"
            >
              <SkipBack />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goNext}
              disabled={!src || segments.length === 0}
              aria-label="Next rally"
              title="Next rally (→)"
            >
              <SkipForward />
            </Button>
            <span className="ml-1 text-sm tabular-nums text-muted-foreground">
              {formatDuration(time)} / {formatDuration(duration)}
            </span>
            <span
              className="ml-2 hidden truncate text-sm sm:inline"
              data-testid="current-rally"
            >
              {current
                ? `Rally ${current.number} of ${allSegments.length}`
                : segments.length > 0
                  ? "Break"
                  : ""}
            </span>
            <Button
              variant={skipBreaks ? "default" : "outline"}
              size="sm"
              className="ml-auto"
              aria-pressed={skipBreaks}
              onClick={() => setSkipBreaks((on) => !on)}
              title="Play only the rallies"
            >
              <FastForward />
              Skip breaks
            </Button>
          </div>
        </div>

        {rallies.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : rallies.isError ? (
          <Alert variant="destructive">
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
            videoDuration={duration}
            currentNumber={current?.number}
            sort={sort}
            onSortChange={setSort}
            minLength={minLength}
            onMinLengthChange={setMinLength}
            onSelect={playSegment}
            // Side panel on wide screens: as tall as the window, scrolls by itself.
            className="lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)]"
          />
        )}
      </div>
    </div>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-sm text-white">
      <p>{text}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
