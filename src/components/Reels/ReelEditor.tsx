import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, Redo2, Undo2, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer, useState } from "react"

import type { RallyPublic, ReelPublic, VideoPublic } from "@/client"
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  PauseIcon,
  PlayIcon,
} from "@/components/Common/AppIcons"
import {
  ControlButton,
  ControlRow,
  RallyBadge,
  SkipBreaksPill,
} from "@/components/Player/controls"
import { RallyScrubber } from "@/components/Player/RallyScrubber"
import {
  nextSegment,
  previousSegment,
  segmentAt,
  toSegments,
} from "@/components/Player/rallies"
import { usePlayerKeys } from "@/components/Player/usePlayerKeys"
import { useVideoPlayer } from "@/components/Player/useVideoPlayer"
import { VideoStage } from "@/components/Player/VideoStage"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ralliesQueryOptions } from "@/components/Videos/queries"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { HighlightsPanel } from "./HighlightsPanel"
import {
  type Edit,
  editReducer,
  initialHistory,
  normalizeEdit,
  type ReelFormat,
  reelLength,
} from "./reelEdit"
import { type SaveStatus, useReelAutosave } from "./useReelAutosave"

export type EditorMode = "highlights" | "edit"

/**
 * The highlight editor. Top half (shared by both modes): header, the video, the
 * time row and the Highlights | Edit toggle. The edit list lives in one reducer
 * with undo / redo, and is autosaved.
 */
export function ReelEditor({
  video,
  reel,
  mode,
  onModeChange,
}: {
  video: VideoPublic
  reel: ReelPublic
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}) {
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const [history, dispatch] = useReducer(editReducer, reel.edit, (edit) =>
    initialHistory(normalizeEdit(edit)),
  )
  const edit = history.present
  const onReload = useCallback(
    (fresh: Edit) => dispatch({ type: "load", edit: fresh }),
    [],
  )
  const autosave = useReelAutosave({ reel, edit, onReload })
  const undo = () => dispatch({ type: "undo" })
  const redo = () => dispatch({ type: "redo" })

  // A 9:16 reel shows the middle of the (landscape) footage, as it will be cut.
  const videoAspect =
    video.width && video.height ? video.width / video.height : 16 / 9
  const frameAspect = edit.format === "9:16" ? 9 / 16 : videoAspect

  const [skipBreaks, setSkipBreaks] = useState(false)
  const player = useVideoPlayer(video, {
    landscape: frameAspect >= 1,
    skipBreaks: () => ({ enabled: skipBreaks, segments }),
  })
  const { time, duration, paused, src } = player

  const segments = useMemo(
    () => toSegments(rallies.data?.data ?? [], duration),
    [rallies.data, duration],
  )
  const current = segmentAt(segments, time)
  const playSegment = (segment: (typeof segments)[number] | undefined) => {
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
  useUndoKeys({ undo, redo })

  const title = reel.title
  const toggleSkipBreaks = () => setSkipBreaks((on) => !on)
  const rallyBadge = current && <RallyBadge number={current.number} />
  const inFullscreen = player.fullscreen.active
  const reelSeconds = reelLength(edit, duration)
  const isPicked = useCallback(
    (rally: RallyPublic) => edit.clips.some((c) => c.rally_id === rally.id),
    [edit.clips],
  )

  return (
    <div
      className={cn(
        "flex flex-col",
        // Phones held upright: one screen like the prototypes. The top half stays,
        // the bottom half (rally list / timeline) scrolls by itself.
        "max-md:portrait:-m-4 max-md:portrait:h-dvh",
      )}
    >
      <EditorHeader
        video={video}
        title={title}
        clipCount={edit.clips.length}
        reelSeconds={reelSeconds}
        saveStatus={autosave.status}
        onRetrySave={() => void autosave.retry()}
      />

      <div className="max-md:px-3 max-md:dark:px-0">
        <VideoStage
          player={player}
          title={title}
          aspect={frameAspect}
          // The bottom half needs room: the video takes at most ~40% of a phone.
          maxInlineHeight="40dvh"
          cropToFrame={frameAspect < videoAspect}
          className="rounded-xl max-md:dark:rounded-none"
          inlineOverlays={
            <>
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
              <div className="pr-2.5">
                <RallyScrubber
                  duration={duration}
                  time={time}
                  segments={segments}
                  visibleNumbers={new Set(segments.map((s) => s.number))}
                  currentNumber={current?.number}
                  onSeek={player.seek}
                  onScrubbingChange={player.setScrubbing}
                />
              </div>
              <ControlRow
                time={time}
                duration={duration}
                paused={paused}
                canPlay={Boolean(src)}
                canNavigate={Boolean(src) && segments.length > 0}
                onPrevious={goPrevious}
                onTogglePlay={player.togglePlay}
                onNext={goNext}
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

      {/* Time row: time · play · undo · redo · format · full screen */}
      <div
        className={cn(
          "flex items-center pt-1 pr-1.5 pl-4 md:px-0",
          inFullscreen && "invisible",
        )}
      >
        <span className="min-w-0 flex-1 whitespace-nowrap text-[13px] tabular-nums">
          {formatDuration(time)}
          <span className="text-muted-foreground">
            {" "}
            / {formatDuration(duration)}
          </span>
        </span>
        <ControlButton
          label={paused ? "Play" : "Pause"}
          title={paused ? "Play (space)" : "Pause (space)"}
          onClick={player.togglePlay}
          disabled={!src}
        >
          {paused ? (
            <PlayIcon className="size-[26px]" />
          ) : (
            <PauseIcon className="size-[26px]" />
          )}
        </ControlButton>
        <ControlButton
          label="Undo"
          title="Undo (⌘Z)"
          onClick={undo}
          disabled={history.past.length === 0}
        >
          <Undo2 className="size-5" />
        </ControlButton>
        <ControlButton
          label="Redo"
          title="Redo (⇧⌘Z)"
          onClick={redo}
          disabled={history.future.length === 0}
        >
          <Redo2 className="size-5" />
        </ControlButton>
        <FormatChip
          format={edit.format}
          onChange={(format) => dispatch({ type: "set-format", format })}
        />
        <ControlButton
          ref={player.fullscreen.triggerRef}
          label="Full screen"
          onClick={player.fullscreen.enter}
          disabled={!src}
        >
          <FullscreenIcon className="size-5" />
        </ControlButton>
      </div>

      {/* Highlights | Edit */}
      <div className="px-4 pt-0.5 pb-2.5 md:px-0">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => next && onModeChange(next as EditorMode)}
          aria-label="Editor mode"
          className="grid w-full grid-cols-2 rounded-[12px] bg-card p-[3px]"
        >
          {(
            [
              ["highlights", "Highlights"],
              ["edit", "Edit"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={cn(
                "h-[34px] rounded-[9px] text-[13px]",
                "data-[state=off]:bg-transparent data-[state=off]:font-bold data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground",
                "data-[state=on]:bg-foreground data-[state=on]:font-extrabold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
              )}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Bottom half: the mode's tools */}
      {mode === "highlights" ? (
        <HighlightsPanel
          segments={segments}
          isPicked={isPicked}
          currentNumber={current?.number}
          pickedCount={edit.clips.length}
          reelSeconds={reelSeconds}
          onToggle={(rally, pick) =>
            dispatch(
              pick
                ? { type: "pick-rally", rally, duration }
                : { type: "unpick-rally", rallyId: rally.id },
            )
          }
          onJump={playSegment}
          onEditReel={() => onModeChange("edit")}
        />
      ) : (
        <section
          aria-label="Edit"
          data-testid="editor-panel"
          className="mx-4 mt-1 mb-4 rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground md:mx-0"
        >
          The timeline comes next.
        </section>
      )}
    </div>
  )
}

/** Back to the match, title, reel length + save state, Export (not yet). */
function EditorHeader({
  video,
  title,
  clipCount,
  reelSeconds,
  saveStatus,
  onRetrySave,
}: {
  video: VideoPublic
  title: string
  clipCount: number
  reelSeconds: number
  saveStatus: SaveStatus
  onRetrySave: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 py-2 pr-3 pl-1 md:mb-4 md:h-auto md:p-0">
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-md md:-ml-3"
      >
        <Link
          to="/videos/$id"
          params={{ id: video.id }}
          aria-label="Back to the match"
        >
          <ChevronLeft className="size-[22px]" />
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-[15px] font-extrabold md:text-[26px] md:tracking-[-0.01em]">
          {title}
        </h1>
        <p className="truncate text-xs text-muted-foreground tabular-nums md:text-[13px]">
          {clipCount} {clipCount === 1 ? "rally" : "rallies"} ·{" "}
          <span data-testid="reel-length">{formatDuration(reelSeconds)}</span> ·{" "}
          <SaveIndicator status={saveStatus} onRetry={onRetrySave} />
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-0.5">
        <Button size="sm" disabled aria-describedby="export-soon">
          <Upload />
          Export
        </Button>
        <span
          id="export-soon"
          className="text-[10px] font-bold text-muted-foreground"
        >
          Coming soon
        </span>
      </div>
    </header>
  )
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus
  onRetry: () => void
}) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="font-bold text-highlight-text underline underline-offset-2"
      >
        Not saved · Retry
      </button>
    )
  }
  return (
    <span data-testid="save-status" aria-live="polite">
      {status === "saved" ? "Saved" : "Saving…"}
    </span>
  )
}

/** 16:9 ⇄ 9:16. A small pill in a 44 px target, like the other row buttons. */
function FormatChip({
  format,
  onChange,
}: {
  format: ReelFormat
  onChange: (format: ReelFormat) => void
}) {
  const other: ReelFormat = format === "16:9" ? "9:16" : "16:9"
  return (
    <button
      type="button"
      onClick={() => onChange(other)}
      aria-label={`Format ${format}. Switch to ${other}`}
      title={`Switch to ${other}`}
      className="group flex h-11 items-center px-1 outline-none"
    >
      <span className="flex h-7 min-w-11 items-center justify-center rounded-full border-[1.5px] border-border px-2 text-xs font-extrabold tabular-nums group-hover:bg-secondary group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {format}
      </span>
    </button>
  )
}

/** ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo (not while typing). */
function useUndoKeys({ undo, redo }: { undo: () => void; redo: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable='true']")) return
      const key = event.key.toLowerCase()
      if (key === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === "y") {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [undo, redo])
}
