import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, ChevronLeft, Redo2, Undo2, Upload } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import type {
  RallyChange,
  RallyPublic,
  ReelPublic,
  VideoPublic,
} from "@/client"
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
  type Segment,
  segmentAt,
  toSegments,
} from "@/components/Player/rallies"
import { usePlayerKeys } from "@/components/Player/usePlayerKeys"
import {
  type PlaybackRule,
  useVideoPlayer,
} from "@/components/Player/useVideoPlayer"
import { VideoStage } from "@/components/Player/VideoStage"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  invalidateVideoLists,
  ralliesQueryOptions,
} from "@/components/Videos/queries"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import { EditPanel } from "./EditPanel"
import { EditTools } from "./EditTools"
import { type FixKind, HighlightsPanel } from "./HighlightsPanel"
import { reelQueryOptions } from "./queries"
import {
  type FixRequest,
  type FixValues,
  RallyFixDialog,
} from "./RallyFixDialog"
import {
  applyFix,
  describeFix,
  describeImpact,
  type NewFix,
  type RallyFix,
  reverseFix,
} from "./rallyFixes"
import {
  canCut,
  canRedo,
  canUndo,
  captionOf,
  clipOfRally,
  type Edit,
  editReducer,
  fixToRedo,
  fixToUndo,
  initialHistory,
  joinTouching,
  keptLength,
  MIN_SPAN,
  normalizeEdit,
  type PieceRef,
  presentEdit,
  type ReelFormat,
  rallyWindows,
  refit,
} from "./reelEdit"
import { useThumbnails } from "./thumbnails"
import {
  buildTimeline,
  pieceAtSource,
  reelTimeAtSource,
  sourceAtReelTime,
  timelineLength,
} from "./timeline"
import { type SaveStatus, useReelAutosave } from "./useReelAutosave"

export type EditorMode = "highlights" | "edit"

/**
 * The highlight editor. Top half (shared by both modes): header, the video, the
 * time row and the Highlights | Edit toggle. The edit list lives in one reducer
 * with undo / redo, and is autosaved. Rally fixes (Highlights' ⋮ menu) change the
 * match's rallies on the server and are undone through the reverse endpoint.
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
  const queryClient = useQueryClient()
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const rallyList = useMemo(() => rallies.data?.data ?? [], [rallies.data])
  const thumbs = useThumbnails(video.id)
  const [history, dispatch] = useReducer(editReducer, reel.edit, (edit) =>
    initialHistory(normalizeEdit(edit)),
  )
  const edit = presentEdit(history)
  // For async work (fixes, toasts): the latest, not the one from when it started
  const historyRef = useRef(history)
  historyRef.current = history
  const onReload = useCallback(
    (fresh: Edit) => dispatch({ type: "load", edit: fresh }),
    [],
  )
  const autosave = useReelAutosave({ reel, edit, onReload })

  // A 9:16 reel shows the middle of the (landscape) footage, as it will be cut.
  const videoAspect =
    video.width && video.height ? video.width / video.height : 16 / 9
  const frameAspect = edit.format === "9:16" ? 9 / 16 : videoAspect

  const [skipBreaks, setSkipBreaks] = useState(false)
  const [loop, setLoop] = useState(false)
  const player = useVideoPlayer(video, {
    landscape: frameAspect >= 1,
    playback: () => playbackRule(),
  })
  const { time, duration, paused, src } = player

  const segments = useMemo(
    () => toSegments(rallyList, duration),
    [rallyList, duration],
  )
  const windows = useMemo(
    () =>
      rallyWindows(
        rallyList,
        { lead_in: edit.lead_in, lead_out: edit.lead_out },
        duration,
      ),
    [rallyList, edit.lead_in, edit.lead_out, duration],
  )
  // The reel as items in reel order: the timeline, the time row and playback read it.
  const items = useMemo(
    () => buildTimeline(edit, segments, windows, duration),
    [edit, segments, windows, duration],
  )
  const reelSeconds = timelineLength(items)
  const reelTime = reelTimeAtSource(items, time)
  const current = segmentAt(segments, time)

  // --- Selection: the piece under the playhead (or the last one tapped) ---------------
  const [selection, setSelection] = useState<PieceRef>()
  const under = pieceAtSource(items, time)
  // Keyed by rally and position, not index: adding a clip before it is no move
  const underKey = under ? `${under.clip.rally_id}:${under.piece.start}` : ""
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the key only
  useEffect(() => {
    if (under)
      setSelection({ clipIndex: under.clipIndex, pieceIndex: under.pieceIndex })
  }, [underKey])
  const selected: PieceRef | undefined =
    selection && edit.clips[selection.clipIndex]?.pieces[selection.pieceIndex]
      ? selection
      : edit.clips.length > 0
        ? { clipIndex: 0, pieceIndex: 0 }
        : undefined
  const selectedItem = items.find(
    (item) =>
      item.kind === "piece" &&
      item.clipIndex === selected?.clipIndex &&
      item.pieceIndex === selected.pieceIndex,
  )
  const selectedPiece =
    selected && edit.clips[selected.clipIndex].pieces[selected.pieceIndex]
  const selectedClip = selected && edit.clips[selected.clipIndex]
  const selectedNumber = segments.find(
    (s) => s.rally.id === selectedClip?.rally_id,
  )?.number
  const pieceLabel = selectedNumber ? `Rally ${selectedNumber}` : "Clip"

  const playSegment = (segment: Segment | undefined) => {
    if (!segment) return
    player.seek(segment.start)
    player.play()
  }
  // Highlights: ← / → go through the match's rallies. Edit: through the reel's pieces.
  const goNext = () =>
    mode === "edit"
      ? playSegment(nextSegment(reelPieces, player.currentTime()))
      : playSegment(nextSegment(segments, player.currentTime()))
  const goPrevious = () =>
    mode === "edit"
      ? playSegment(previousSegment(reelPieces, player.currentTime()))
      : playSegment(previousSegment(segments, player.currentTime()))

  // --- Preview playback --------------------------------------------------------------
  // Edit mode plays the reel as edited: its pieces in order, the footage kept around
  // them ("Rallies only": restored breaks; "Full video": everything, without the breaks
  // and cut parts when skip-breaks is on), slow-mo at half speed. Loop repeats the
  // selected piece. Highlights mode plays the match freely (tap any rally to watch it).
  const playbackRule = (): PlaybackRule => {
    if (mode !== "edit") return { spans: skipBreaks ? segments : null }
    if (loop && selectedItem?.kind === "piece") {
      const rate = selectedItem.piece.slow_mo ? 0.5 : 1
      return { spans: [selectedItem.src], loop: true, rateAt: () => rate }
    }
    const skipping = edit.view === "full" && skipBreaks
    const plays = items.filter(
      (item) =>
        item.kind !== "gap" &&
        !(skipping && (item.kind === "break" || item.kind === "cut")),
    )
    return {
      spans: mergeSpans(plays.map((item) => item.src)),
      rateAt: (t) =>
        plays.some(
          (item) =>
            item.kind === "piece" &&
            item.piece.slow_mo &&
            t >= item.src.start &&
            t < item.src.end,
        )
          ? 0.5
          : 1,
    }
  }
  // The reel's pieces as segments: in source time (← / →) and in reel time (the
  // full-screen chapter bar draws each chapter from its rally's times).
  const pieceSegments = (time: "src" | "reel"): Segment[] =>
    items.flatMap((item, i) =>
      item.kind === "piece"
        ? [
            {
              number: item.segment?.number ?? i + 1,
              rally: {
                id: (item.segment?.rally.id ?? -1 - i) * 1000 + item.pieceIndex,
                number: item.segment?.number ?? i + 1,
                start: item[time].start,
                end: item[time].end,
                duration: item[time].end - item[time].start,
              },
              start: item[time].start,
              end: item[time].end,
            },
          ]
        : [],
    )
  const reelPieces = pieceSegments("src")
  const reelChapters = pieceSegments("reel")

  // What's on screen now: a slow-mo piece (Edit plays it slowly) and the caption.
  const playingSlow = mode === "edit" && under?.piece.slow_mo
  const caption = edit.overlays.captions.find(
    (c) => time >= c.start && time < c.end,
  )

  // --- Rally fixes ---------------------------------------------------------------------
  const [fixBusy, setFixBusy] = useState(false)
  const busy = useRef(false)
  const [fixRequest, setFixRequest] = useState<FixRequest>(null)

  /** The rallies changed on the server: the player, lists and this screen see it. */
  const applyRallies = (change: RallyChange) => {
    queryClient.setQueryData(ralliesQueryOptions(video.id).queryKey, {
      data: change.rallies,
      count: change.rallies.length,
    })
    void queryClient.invalidateQueries({
      queryKey: ["videos", video.id],
      exact: true,
    })
    void invalidateVideoLists(queryClient)
  }

  /**
   * One server call at a time, with the reel saved first and no autosave meanwhile
   * (the server adjusts reels as part of a fix).
   */
  const exclusive = async (work: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    setFixBusy(true)
    try {
      await autosave.flush()
      autosave.hold(true)
      await work()
    } finally {
      autosave.hold(false)
      busy.current = false
      setFixBusy(false)
    }
  }

  /** Make a fix: refresh rallies and the reel, one undo step, say what changed. */
  const runFix = (pending: NewFix) =>
    exclusive(async () => {
      const before = rallyList
      const result = await applyFix(video.id, pending)
      const fix = { ...pending, after: result.ids } as RallyFix
      applyRallies(result.change)
      let next = presentEdit(historyRef.current)
      if (result.reels.some((r) => r.id === reel.id)) {
        // The server adjusted this reel: start from its version
        const fresh = await queryClient.fetchQuery({
          ...reelQueryOptions(video.id, reel.id),
          staleTime: 0,
        })
        autosave.adopt(fresh)
        next = normalizeEdit(fresh.edit)
      }
      // Clips follow their rallies' new windows (a longer rally = a longer clip)
      next = refit(
        next,
        rallyWindows(before, next, duration),
        rallyWindows(result.change.rallies, next, duration),
      )
      if (fix.kind === "merge") next = joinTouching(next, fix.after[0])
      dispatch({ type: "fix", fix, edit: next })
      toast.success(describeFix(fix, result.change), {
        description: describeImpact(result.reels, reel.id),
        action: {
          label: "Undo",
          onClick: () => {
            if (fixToUndo(historyRef.current) === fix) void undo()
          },
        },
      })
    })

  const fixFailed = (title: string) => (error: unknown) =>
    toast.error(title, { description: extractErrorMessage(error as Error) })

  const onFix = (kind: FixKind, segment: Segment) => {
    const { rally } = segment
    const from = { start: rally.start, end: rally.end }
    if (kind === "edit") setFixRequest({ kind: "edit", rally })
    else if (kind === "split") {
      // At the playhead if it's inside the rally, else in the middle
      const t = Math.round(player.currentTime() * 10) / 10
      const inside = t - rally.start >= 0.1 && rally.end - t >= 0.1
      const middle = Math.round(((rally.start + rally.end) / 2) * 10) / 10
      setFixRequest({ kind: "split", rally, at: inside ? t : middle })
    } else if (kind === "delete") {
      runFix({ kind: "delete", before: [rally.id], from }).catch(
        fixFailed(`Couldn't delete rally ${segment.number}`),
      )
    } else {
      const next = segments[segments.indexOf(segment) + 1]
      if (!next) return
      runFix({
        kind: "merge",
        before: [rally.id, next.rally.id],
        first: from,
        second: { start: next.rally.start, end: next.rally.end },
      }).catch(fixFailed(`Couldn't merge rally ${segment.number}`))
    }
  }

  const onAddMissed = () => {
    // From the playhead (or the end of the rally it's in) for up to 4 s, before the next
    const t = Math.round(player.currentTime() * 10) / 10
    const inside = rallyList.find((r) => t >= r.start && t < r.end)
    const start = inside ? inside.end : t
    const nextStart = Math.min(
      ...rallyList.filter((r) => r.start >= start).map((r) => r.start),
      duration > 0 ? duration : start + 4,
    )
    setFixRequest({
      kind: "add",
      start,
      end: Math.round(Math.min(start + 4, nextStart) * 10) / 10,
    })
  }

  const submitFix = (values: FixValues) => {
    const request = fixRequest
    if (!request) return Promise.resolve()
    if (values.kind === "add") {
      return runFix({
        kind: "add",
        before: [],
        to: { start: values.start, end: values.end },
      })
    }
    if (request.kind === "add") return Promise.resolve()
    const { rally } = request
    const from = { start: rally.start, end: rally.end }
    return values.kind === "split"
      ? runFix({ kind: "split", before: [rally.id], from, at: values.at })
      : runFix({
          kind: "edit",
          before: [rally.id],
          from,
          to: { start: values.start, end: values.end },
        })
  }

  // --- Undo / redo (a rally fix calls the server first) ---------------------------------
  const undo = async () => {
    const fix = fixToUndo(historyRef.current)
    if (!fix) {
      dispatch({ type: "undo" })
      return
    }
    await exclusive(async () => {
      const result = await reverseFix(video.id, fix)
      applyRallies(result.change)
      const mine = result.reels.find((r) => r.id === reel.id)
      if (mine) autosave.rebase(mine.updated_at)
      dispatch({ type: "undo-fix", ids: result.ids })
      toast.success("Rally fix undone", {
        description: "The player's chapters are updated too.",
      })
    }).catch(fixFailed("Couldn't undo the rally fix"))
  }
  const redo = async () => {
    const fix = fixToRedo(historyRef.current)
    if (!fix) {
      dispatch({ type: "redo" })
      return
    }
    await exclusive(async () => {
      const result = await applyFix(video.id, fix)
      applyRallies(result.change)
      const mine = result.reels.find((r) => r.id === reel.id)
      if (mine) autosave.rebase(mine.updated_at)
      dispatch({ type: "redo-fix", ids: result.ids })
      toast.success(
        describeFix({ ...fix, after: result.ids } as RallyFix, result.change),
        {
          description: "Done again. The player's chapters are updated too.",
        },
      )
    }).catch(fixFailed("Couldn't redo the rally fix"))
  }

  usePlayerKeys({
    " ": player.togglePlay,
    ArrowRight: goNext,
    ArrowLeft: goPrevious,
  })
  useUndoKeys({ undo, redo })

  // --- Edit tools ------------------------------------------------------------------
  const onCut = () => {
    if (!selected) return
    const at = player.currentTime()
    if (!canCut(edit, selected, at)) return
    dispatch({ type: "cut-piece", piece: selected, at })
    // The second part is selected (the playhead is at its start)
    setSelection({ ...selected, pieceIndex: selected.pieceIndex + 1 })
  }
  const onDelete = () => {
    if (!selected || !selectedClip) return
    dispatch({ type: "delete-piece", piece: selected })
    setSelection(
      selectedClip.pieces.length > 1
        ? { ...selected, pieceIndex: Math.max(0, selected.pieceIndex - 1) }
        : undefined,
    )
  }
  const pickRally = (rally: RallyPublic) => {
    const window = windows.get(rally.id)
    if (!window) return
    dispatch({ type: "pick-rally", rallyId: rally.id, window })
    return edit.clips.filter((c) => c.pieces[0].start < window.start).length
  }

  const title = reel.title
  const rallyBadge = current && <RallyBadge number={current.number} />
  const inFullscreen = player.fullscreen.active
  // Edit + "Rallies only": the breaks are cut by the edit itself, so the pill says so
  // instead of offering to skip them.
  const breaksCut = mode === "edit" && edit.view === "cut"
  const pill = (className?: string) =>
    breaksCut ? (
      <BreaksCutPill className={className} />
    ) : (
      <SkipBreaksPill
        on={skipBreaks}
        onToggle={() => setSkipBreaks((on) => !on)}
        className={className}
      />
    )
  const isPicked = useCallback(
    (rally: RallyPublic) => edit.clips.some((c) => c.rally_id === rally.id),
    [edit.clips],
  )
  /** Seconds kept, for a rally cut in this reel (less than its whole window). */
  const keptOf = (rally: RallyPublic) => {
    const clip = clipOfRally(edit, rally.id)
    const window = windows.get(rally.id)
    if (!clip || !window) return undefined
    const kept = keptLength(clip)
    return kept < window.end - window.start - MIN_SPAN ? kept : undefined
  }

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
        onRetrySave={autosave.retry}
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
              {playingSlow && (
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
                {mode === "edit" ? (
                  // The reel's chapters, in reel time (as in the prototype)
                  <RallyScrubber
                    duration={reelSeconds}
                    time={reelTime}
                    segments={reelChapters}
                    visibleNumbers={
                      new Set(reelChapters.map((chapter) => chapter.number))
                    }
                    currentNumber={
                      reelChapters.find(
                        (c) => reelTime >= c.start && reelTime < c.end,
                      )?.number
                    }
                    onSeek={(t) => {
                      const source = sourceAtReelTime(items, t)
                      if (source !== undefined) player.seek(source)
                    }}
                    onScrubbingChange={player.setScrubbing}
                  />
                ) : (
                  <RallyScrubber
                    duration={duration}
                    time={time}
                    segments={segments}
                    visibleNumbers={new Set(segments.map((s) => s.number))}
                    currentNumber={current?.number}
                    onSeek={player.seek}
                    onScrubbingChange={player.setScrubbing}
                  />
                )}
              </div>
              <ControlRow
                time={mode === "edit" ? reelTime : time}
                duration={mode === "edit" ? reelSeconds : duration}
                paused={paused}
                canPlay={Boolean(src)}
                canNavigate={
                  Boolean(src) &&
                  (mode === "edit" ? reelPieces : segments).length > 0
                }
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
          onClick={() => void undo()}
          disabled={!canUndo(history) || fixBusy}
        >
          <Undo2 className="size-5" />
        </ControlButton>
        <ControlButton
          label="Redo"
          title="Redo (⇧⌘Z)"
          onClick={() => void redo()}
          disabled={!canRedo(history) || fixBusy}
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
          keptOf={keptOf}
          currentNumber={current?.number}
          pickedCount={edit.clips.length}
          reelSeconds={reelSeconds}
          thumbs={thumbs}
          fixBusy={fixBusy}
          onToggle={(rally, pick) =>
            pick
              ? pickRally(rally)
              : dispatch({ type: "unpick-rally", rallyId: rally.id })
          }
          onJump={playSegment}
          onFix={onFix}
          onAddMissed={onAddMissed}
          onEditReel={() => onModeChange("edit")}
        />
      ) : (
        <EditPanel
          edit={edit}
          items={items}
          reelTime={reelTime}
          selected={selected}
          thumbs={thumbs}
          onSetView={(view) => dispatch({ type: "set-view", view })}
          onSetLead={(lead) =>
            dispatch({ type: "set-lead", lead, rallies: rallyList, duration })
          }
          timeline={{
            onScrubStart: player.pause,
            onScrub: (t) => {
              const source = sourceAtReelTime(items, t)
              if (source !== undefined) player.seek(source)
            },
            onSelectPiece: (piece, t) => {
              setSelection(piece)
              player.seek(t)
            },
            onRestoreHidden: (hidden) =>
              dispatch({ type: "restore-hidden", hidden }),
            onHide: (region) => dispatch({ type: "hide-region", region }),
            onRestoreCut: (clipIndex, span) =>
              dispatch({ type: "restore-cut", clipIndex, span }),
            onPick: (rally) => {
              const clipIndex = pickRally(rally)
              if (clipIndex !== undefined)
                setSelection({ clipIndex, pieceIndex: 0 })
            },
          }}
        >
          <EditTools
            edit={edit}
            piece={selectedPiece}
            pieceLabel={pieceLabel}
            part={
              selected && selectedClip
                ? [selected.pieceIndex + 1, selectedClip.pieces.length]
                : undefined
            }
            canCut={canCut(edit, selected, time)}
            loop={loop}
            caption={
              selectedPiece ? captionOf(edit, selectedPiece)?.text : undefined
            }
            onCut={onCut}
            onDelete={onDelete}
            onToggleSlowMo={() =>
              selected && dispatch({ type: "toggle-slow-mo", piece: selected })
            }
            onToggleLoop={() => setLoop((on) => !on)}
            onSetCaption={(text) =>
              selectedPiece &&
              dispatch({ type: "set-caption", span: selectedPiece, text })
            }
            onToggleFormat={() =>
              dispatch({
                type: "set-format",
                format: edit.format === "16:9" ? "9:16" : "16:9",
              })
            }
          />
        </EditPanel>
      )}

      <RallyFixDialog
        request={fixRequest}
        duration={duration}
        now={player.currentTime}
        onPreview={(t) => {
          player.pause()
          player.seek(t)
        }}
        onSubmit={submitFix}
        onClose={() => setFixRequest(null)}
      />
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
function useUndoKeys({
  undo,
  redo,
}: {
  undo: () => Promise<void>
  redo: () => Promise<void>
}) {
  const latest = useRef({ undo, redo })
  latest.current = { undo, redo }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable='true']")) return
      if (target.closest("[role='dialog']")) return
      const key = event.key.toLowerCase()
      if (key === "z") {
        event.preventDefault()
        void (event.shiftKey ? latest.current.redo() : latest.current.undo())
      } else if (key === "y") {
        event.preventDefault()
        void latest.current.redo()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
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

/** Stretches that touch (one ends where the next starts) play as one. */
function mergeSpans(spans: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start - last.end < 0.05)
      last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}
