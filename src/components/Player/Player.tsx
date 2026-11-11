import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ChevronLeft,
  EllipsisVertical,
  MapPin,
  Trash2,
  TriangleExclamationPoint,
} from "lucide-react"
import { useMemo, useState } from "react"

import type { VideoPublic } from "@/client"
import {
  ExitFullscreenIcon,
  FullscreenIcon,
} from "@/components/Common/AppIcons"
import { MakeHighlightButton } from "@/components/Reels/MakeHighlightButton"
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
import { ralliesQueryOptions } from "@/components/Videos/queries"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import {
  ControlButton,
  ControlRow,
  RallyBadge,
  SkipBreaksPill,
} from "./controls"
import { RallyList, type RallySort } from "./RallyList"
import { RallyScrubber } from "./RallyScrubber"
import {
  nextSegment,
  previousSegment,
  rallyTime,
  type Segment,
  segmentAt,
  toSegments,
} from "./rallies"
import { usePlayerKeys } from "./usePlayerKeys"
import { useVideoPlayer } from "./useVideoPlayer"
import { VideoStage } from "./VideoStage"

export function Player({ video }: { video: VideoPublic }) {
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const [skipBreaks, setSkipBreaks] = useState(false)
  const [sort, setSort] = useState<RallySort>("time")
  const [minLength, setMinLength] = useState(0)

  const aspect =
    video.width && video.height ? video.width / video.height : 16 / 9
  const player = useVideoPlayer(video, {
    landscape: aspect >= 1,
    playback: () => ({ spans: skipBreaks ? segments : null }),
  })
  const { time, duration, paused, src } = player

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

  /** Jump to a rally (with its padding) and play it. */
  const playSegment = (segment: Segment | undefined) => {
    if (!segment) return
    player.seek(segment.start)
    player.play()
  }
  const goNext = () => playSegment(nextSegment(segments, player.currentTime()))
  const goPrevious = () =>
    playSegment(previousSegment(segments, player.currentTime()))

  usePlayerKeys({
    " ": player.togglePlay,
    ArrowRight: goNext,
    ArrowLeft: goPrevious,
  })

  // Stats over all rallies (not the filter): what the recording contains.
  const playTime = rallyTime(allSegments)
  const visibleNumbers = useMemo(
    () => new Set(segments.map((s) => s.number)),
    [segments],
  )
  const longest = Math.max(0, ...allSegments.map((s) => s.rally.duration))

  // --- Pieces shown inline and in full screen: same state, same handlers -------------
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
      onSeek={player.seek}
      onScrubbingChange={player.setScrubbing}
    />
  )
  const controlRowProps = {
    time,
    duration,
    paused,
    canPlay: Boolean(src),
    canNavigate: Boolean(src) && segments.length > 0,
    onPrevious: goPrevious,
    onTogglePlay: player.togglePlay,
    onNext: goNext,
  }
  const inFullscreen = player.fullscreen.active

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
      <PlayerHeader video={video} />

      <div className="flex min-h-0 flex-1 flex-col md:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex shrink-0 flex-col">
          {/* Light phones: inset card; dark phones: edge to edge (mockups) */}
          <div className="max-md:px-3 max-md:dark:px-0">
            <VideoStage
              player={player}
              title={title}
              aspect={aspect}
              maxInlineHeight="70dvh"
              className="rounded-xl max-md:dark:rounded-none"
              inlineOverlays={
                <>
                  {/* Rally badge top-left; skip pill bottom-right ("Skip intro") */}
                  {rallyBadge && (
                    <div className="pointer-events-none absolute top-3 left-3">
                      {rallyBadge}
                    </div>
                  )}
                  <SkipBreaksPill
                    on={skipBreaks}
                    onToggle={toggleSkipBreaks}
                    className="absolute right-1.5 bottom-1"
                  />
                </>
              }
              fullscreenBadge={rallyBadge}
              fullscreenTop={
                <SkipBreaksPill on={skipBreaks} onToggle={toggleSkipBreaks} />
              }
              fullscreenBottom={
                <>
                  <div className="pr-2.5">{scrubber}</div>
                  <ControlRow
                    {...controlRowProps}
                    trailing={
                      <ControlButton
                        label="Exit full screen"
                        title="Exit full screen (Esc)"
                        onClick={player.fullscreen.exit}
                      >
                        <ExitFullscreenIcon className="size-5" />
                      </ControlButton>
                    }
                  />
                </>
              }
            />
          </div>

          {/* Hidden (not removed) in full screen: the layout behind stays put */}
          <div
            className={cn("px-4 pt-1.5 md:px-0", inFullscreen && "invisible")}
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
              inFullscreen && "invisible",
            )}
            trailing={
              <ControlButton
                ref={player.fullscreen.triggerRef}
                label="Full screen"
                onClick={player.fullscreen.enter}
                disabled={!src}
              >
                <FullscreenIcon className="size-5" />
              </ControlButton>
            }
          />
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
      <MakeHighlightButton video={video} />
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
