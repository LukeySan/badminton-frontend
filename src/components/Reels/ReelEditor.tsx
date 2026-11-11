import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, ChevronLeft, Redo2, Undo2, Upload } from "lucide-react"
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
import { EditPanel, type TrimCallbacks } from "./EditPanel"
import { EditTools } from "./EditTools"
import { HighlightsPanel } from "./HighlightsPanel"
import {
  captionOfClip,
  constrainTrim,
  type Edit,
  editReducer,
  initialHistory,
  normalizeEdit,
  type ReelFormat,
  reelLength,
} from "./reelEdit"
import {
  buildTimeline,
  clipIndexAtSource,
  reelTimeAtSource,
  sourceAtReelTime,
} from "./timeline"
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
  // While a trim handle is dragged, the timeline shows the new edges; the edit list
  // only changes on release (one undo step, one save).
  const [trimPreview, setTrimPreview] = useState<{
    clipIndex: number
    trim_start: number
    trim_end: number
  } | null>(null)
  const shown: Edit = useMemo(
    () =>
      trimPreview
        ? {
            ...edit,
            clips: edit.clips.map((clip, i) =>
              i === trimPreview.clipIndex ? { ...clip, ...trimPreview } : clip,
            ),
          }
        : edit,
    [edit, trimPreview],
  )
  const reelSeconds = reelLength(shown, duration)
  // The reel as items in reel order: the timeline and the time row read from it.
  const items = useMemo(
    () => buildTimeline(shown, segments, duration),
    [shown, segments, duration],
  )
  const reelTime = reelTimeAtSource(items, time)
  const [selected, setSelected] = useState<number | undefined>(0)
  const selectedClip =
    selected !== undefined && selected < edit.clips.length
      ? selected
      : edit.clips.length > 0
        ? 0
        : undefined
  const clip = selectedClip !== undefined ? edit.clips[selectedClip] : undefined
  const clipNumber = segments.find((s) => s.rally.id === clip?.rally_id)?.number
  const clipLabel = clipNumber ? `Rally ${clipNumber}` : "Clip"

  const trim: TrimCallbacks = {
    active: trimPreview !== null,
    onDrag: (clipIndex, edge, value) => {
      const next = constrainTrim(edit, clipIndex, edge, value, duration)
      setTrimPreview({ clipIndex, ...next })
      // Show the frame at the edge being moved.
      player.pause()
      player.seek(edge === "start" ? next.trim_start : next.trim_end - 0.05)
    },
    onEnd: () => {
      if (trimPreview) dispatch({ type: "trim-clip", ...trimPreview })
      setTrimPreview(null)
    },
    onNudge: (clipIndex, edge, delta) => {
      const current = edit.clips[clipIndex]
      if (!current) return
      const from = edge === "start" ? current.trim_start : current.trim_end
      const next = constrainTrim(edit, clipIndex, edge, from + delta, duration)
      dispatch({ type: "trim-clip", clipIndex, ...next })
      player.pause()
      player.seek(edge === "start" ? next.trim_start : next.trim_end - 0.05)
    },
  }

  // What's on screen now: the clip playing (slow-mo tag) and its caption.
  const playingClip = clipIndexAtSource(items, time)
  const playing =
    playingClip !== undefined ? shown.clips[playingClip] : undefined
  const caption = shown.overlays.captions.find(
    (c) => time >= c.start && time < c.end,
  )
  // Edit + "Rallies only": the breaks are cut by the edit itself, so the pill says so
  // instead of offering to skip them.
  const breaksCut = mode === "edit" && edit.view === "cut"
  const pill = (className?: string) =>
    breaksCut ? (
      <BreaksCutPill className={className} />
    ) : (
      <SkipBreaksPill
        on={skipBreaks}
        onToggle={toggleSkipBreaks}
        className={className}
      />
    )
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
          frameOverlays={
            <>
              {playing?.slow_mo && (
                <span
                  data-testid="slow-mo-tag"
                  className="pointer-events-none absolute top-3 right-3 rounded-[8px] bg-court-ink/85 px-2.5 py-1 text-xs font-extrabold text-court-foreground"
                >
                  Slow-mo
                </span>
              )}
              {caption && (
                <div className="pointer-events-none absolute inset-x-0 bottom-[46px] flex justify-center px-4">
                  <span
                    data-testid="caption"
                    className="rounded-[8px] bg-court-ink/75 px-2.5 py-1 text-center text-sm font-extrabold text-court-foreground"
                  >
                    {caption.text}
                  </span>
                </div>
              )}
            </>
          }
          className="rounded-xl max-md:dark:rounded-none"
          inlineOverlays={
            <>
              {rallyBadge && (
                <div className="pointer-events-none absolute top-3 left-3">
                  {rallyBadge}
                </div>
              )}
              {pill("absolute right-1.5 bottom-1")}
            </>
          }
          fullscreenBadge={rallyBadge}
          fullscreenTop={pill()}
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
        {/* Reel time: where the playhead is in the reel, and how long the reel is */}
        <span
          data-testid="reel-time"
          className="min-w-0 flex-1 whitespace-nowrap text-[13px] tabular-nums"
        >
          {formatDuration(reelTime)}
          <span className="text-muted-foreground">
            {" "}
            / {formatDuration(reelSeconds)}
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
        <EditPanel
          edit={shown}
          view={edit.view}
          items={items}
          reelTime={reelTime}
          selectedClip={selectedClip}
          onSetView={(view) => dispatch({ type: "set-view", view })}
          onScrubStart={player.pause}
          onScrub={(t) => {
            const source = sourceAtReelTime(items, t)
            if (source !== undefined) player.seek(source)
          }}
          onSelectClip={setSelected}
          onRestore={(region) => dispatch({ type: "restore-region", region })}
          onHide={(region) => dispatch({ type: "hide-region", region })}
          onPick={(rally) => {
            dispatch({ type: "pick-rally", rally, duration })
            // Select the new clip: it lands after the clips that start before it.
            setSelected(
              edit.clips.filter((c) => c.trim_start <= rally.start).length,
            )
          }}
          trim={trim}
        >
          <EditTools
            edit={edit}
            clip={clip}
            clipLabel={clipLabel}
            caption={clip ? captionOfClip(edit, clip)?.text : undefined}
            onNudge={(edge, delta) =>
              selectedClip !== undefined &&
              trim.onNudge(selectedClip, edge, delta)
            }
            onToggleSlowMo={() =>
              selectedClip !== undefined &&
              dispatch({ type: "toggle-slow-mo", clipIndex: selectedClip })
            }
            onSetTrail={(on) => dispatch({ type: "set-trail", on })}
            onSetCaption={(text) =>
              selectedClip !== undefined &&
              dispatch({ type: "set-caption", clipIndex: selectedClip, text })
            }
            onToggleFormat={() =>
              dispatch({
                type: "set-format",
                format: edit.format === "16:9" ? "9:16" : "16:9",
              })
            }
            onRemove={() =>
              selectedClip !== undefined &&
              dispatch({ type: "remove-clip", clipIndex: selectedClip })
            }
          />
        </EditPanel>
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

/** Edit + "Rallies only": a static pill saying the breaks are already cut. */
function BreaksCutPill({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex h-11 items-center px-1.5", className)}
      data-testid="breaks-cut"
    >
      <span className="flex h-[30px] items-center gap-[5px] whitespace-nowrap rounded-full border border-chapter/60 bg-court-ink/80 px-3 text-xs font-extrabold text-court-accent">
        <Check className="size-3.5" strokeWidth={3} />
        Breaks cut
      </span>
    </span>
  )
}
