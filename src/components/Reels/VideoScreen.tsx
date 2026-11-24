import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ChevronLeft,
  EllipsisVertical,
  MapPin,
  Redo2,
  Sparkles,
  Trash2,
  TriangleExclamationPoint,
  Undo2,
  Upload,
} from "lucide-react"
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
  ExportPublic,
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
  isMaybe,
  nextSegment,
  previousSegment,
  rallyTime,
  type Segment,
  segmentAt,
  toSegments,
} from "@/components/Player/rallies"
import { usePlayerKeys } from "@/components/Player/usePlayerKeys"
import {
  FREE_PLAYBACK,
  type PlaybackRule,
  spansRule,
  useVideoPlayer,
} from "@/components/Player/useVideoPlayer"
import { VideoStage } from "@/components/Player/VideoStage"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DeleteVideoDialog } from "@/components/Videos/DeleteVideo"
import {
  invalidateVideoLists,
  ralliesQueryOptions,
} from "@/components/Videos/queries"
import { ReanalyzeDialog } from "@/components/Videos/ReanalyzeDialog"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import { AddFootageSheet } from "./AddFootageSheet"
import { clipMaybes, type Edge, EditPanel } from "./EditPanel"
import { EditTools, OverlayTools } from "./EditTools"
import { EmptyReel } from "./EmptyReel"
import { ExportSheet } from "./ExportSheet"
import { type FixKind, HighlightsPanel } from "./HighlightsPanel"
import { OverlayLayer } from "./OverlayLayer"
import {
  canCutOverlay,
  cleanText,
  fitOverlaySpan,
  isActive,
  MAX_OVERLAYS,
  newOverlayId,
  newTextOverlay,
  type Overlay,
} from "./overlays"
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
  type Clip,
  canCut,
  canRedo,
  canUndo,
  type Edit,
  editReducer,
  fitBounds,
  fixToRedo,
  fixToUndo,
  initialHistory,
  isRallyPicked,
  longestRallies,
  newClipId,
  normalizeEdit,
  paddedRally,
  presentEdit,
  type ReelFormat,
  rallyOver,
  reelLength,
  relabel,
  type Span,
} from "./reelEdit"
import { useThumbnails } from "./thumbnails"
import {
  atReelTime,
  clipIndexAt,
  EDGE_EPSILON,
  reelSpans,
  reelTimeIn,
} from "./timeline"
import { type SaveStatus, useReelAutosave } from "./useReelAutosave"
import { useReelExports } from "./useReelExports"

export type EditorMode = "highlights" | "edit"

/** At most one seek this often while an edge or a range handle moves (ms). */
const PREVIEW_SEEK_MS = 70
/** Pressing "previous" this far into a clip restarts it (like a music app). */
const RESTART_AFTER = 3
/** The reel moves on this long before the video's last frame (see playbackRule). */
const END_GUARD = 0.08
/** Between two looks at the video, more than this is a jump, not playing on (s). */
const JUMP = 0.5
/** Add footage starts with this much, right after the clip under the playhead. */
const ADD_FOOTAGE_SECONDS = 5

/**
 * The one screen for an analyzed video, in two modes. Highlights is the player: the
 * whole match with its rally chapters, stats and the rally list (pick rallies, fix
 * them). Edit is the reel's timeline. Shared: header, the video, the mode toggle.
 *
 * The video's reel (one per video) is made on the first change: until then `reel`
 * is null and the edit list is empty. The edit list (v5: a flat list of clips played
 * in list order) lives in one reducer with undo / redo, and is autosaved. Rally fixes
 * (⋮ in the list) change the match's rallies on the server and are undone through the
 * reverse endpoint; they never change what the reel plays.
 */
export function VideoScreen({
  video,
  reel,
  mode,
  onModeChange,
}: {
  video: VideoPublic
  /** null: the video has no reel yet. */
  reel: ReelPublic | null
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}) {
  const queryClient = useQueryClient()
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const rallyList = useMemo(() => rallies.data?.data ?? [], [rallies.data])
  const thumbs = useThumbnails(video.id)
  const [history, dispatch] = useReducer(editReducer, reel?.edit, (edit) =>
    initialHistory(normalizeEdit(edit)),
  )
  const edit = presentEdit(history)
  const clips = edit.segments
  // For async work (fixes, toasts): the latest, not the one from when it started
  const historyRef = useRef(history)
  historyRef.current = history
  const onReload = useCallback(
    (fresh: Edit) => dispatch({ type: "load", edit: fresh }),
    [],
  )
  const title = video.filename.replace(/\.[^.]+$/, "")
  const autosave = useReelAutosave({
    videoId: video.id,
    title: `${title} highlights`,
    reel,
    edit,
    onReload,
  })

  // A 9:16 reel shows the middle of the (landscape) footage, as it will be cut. Edit
  // shows the output frame (16:9 letterboxes footage of another shape, like the
  // export), so overlays sit where the export puts them.
  const videoAspect =
    video.width && video.height ? video.width / video.height : 16 / 9
  const frameAspect =
    edit.format === "9:16" ? 9 / 16 : mode === "edit" ? 16 / 9 : videoAspect

  const [skipBreaks, setSkipBreaks] = useState(false)
  const player = useVideoPlayer(video, {
    landscape: frameAspect >= 1,
    playback: () => playbackRule(),
  })
  const { time, duration, paused, src } = player

  const segments = useMemo(
    () => toSegments(rallyList, duration),
    [rallyList, duration],
  )
  // "Maybe" rallies (the detector was unsure) are drawn and played, but counted
  // only once the user keeps them.
  const sureRallies = useMemo(
    () => rallyList.filter((rally) => !isMaybe(rally)),
    [rallyList],
  )
  const maybeCount = rallyList.length - sureRallies.length
  const maybes = useMemo(() => clipMaybes(clips, rallyList), [clips, rallyList])
  const reelSeconds = reelLength(edit)
  const [exportOpen, setExportOpen] = useState(false)
  const reelExports = useReelExports({
    videoId: video.id,
    beforeExport: autosave.flush,
    quiet: exportOpen,
    onShow: () => setExportOpen(true),
  })
  const current = segmentAt(segments, time)

  // --- The cursor: the clip that's playing ------------------------------------------
  // Source time can't say where the playhead is in the reel (clips can be in any order
  // and show the same moment twice), so Edit keeps the clip that's playing. It's also
  // the selected clip (tools act on it): playback, scrubbing and taps move it.
  const [cursorId, setCursorState] = useState<string | undefined>(clips[0]?.id)
  const cursorRef = useRef(cursorId)
  const setCursor = useCallback((id: string | undefined) => {
    cursorRef.current = id
    setCursorState(id)
  }, [])
  const resolveCursor = (list: Clip[], t: number) => {
    const i = list.findIndex((clip) => clip.id === cursorRef.current)
    if (i >= 0) return i
    const at = clipIndexAt(list, t)
    return at >= 0 ? at : list.length > 0 ? 0 : -1
  }
  const cursorIndex = resolveCursor(clips, time)
  const cursorClip = clips[cursorIndex] as Clip | undefined
  // A deleted or replaced clip: the cursor moves to what's there now
  useEffect(() => {
    if (cursorClip?.id !== cursorId) setCursor(cursorClip?.id)
  }, [cursorClip?.id, cursorId, setCursor])
  const reelTime = cursorIndex >= 0 ? reelTimeIn(clips, cursorIndex, time) : 0

  /** The last time playback saw (or a seek of ours went to): tells a jump from play. */
  const lastSource = useRef<number | null>(null)
  /** Edit: put the playhead in clip `id`, at `source` in the video. */
  const seekClip = (id: string, source: number) => {
    setCursor(id)
    lastSource.current = source
    player.seek(source)
  }
  /** Edit: put the playhead at a reel time. */
  const seekReel = (t: number) => {
    const at = atReelTime(clips, t)
    if (at) seekClip(clips[at.index].id, at.source)
  }

  // Entering Edit (or the first clip arriving): the cursor and the video agree
  // biome-ignore lint/correctness/useExhaustiveDependencies: on entering only
  useEffect(() => {
    if (mode !== "edit" || clips.length === 0) return
    const t = player.currentTime()
    const clip = clips.find((c) => c.id === cursorRef.current)
    if (clip && t >= clip.start - EDGE_EPSILON && t <= clip.end) return
    const at = clipIndexAt(clips, t)
    if (at >= 0) setCursor(clips[at].id)
    else {
      const first = clip ?? clips[0]
      seekClip(first.id, first.start)
    }
  }, [mode, clips.length > 0])

  // --- Preview playback --------------------------------------------------------------
  // Edit plays the reel: its clips in list order, slow-mo at half speed, stopping after
  // the last (Play starts again from the first). Highlights plays the match freely, or
  // only its rallies with skip-breaks.
  const playbackRule = (): PlaybackRule => {
    if (mode !== "edit") return skipBreaks ? spansRule(segments) : FREE_PLAYBACK
    const list = clips
    // A clip that runs to the video's end moves on just before it: after "ended",
    // play() would start the video over (WebKit)
    const endOf = (clip: Clip) =>
      duration > 0 ? Math.min(clip.end, duration - END_GUARD) : clip.end
    const inside = (clip: Clip, t: number) =>
      t >= clip.start - EDGE_EPSILON && t < endOf(clip)
    const seekTo = (t: number) => {
      lastSource.current = t
      return t
    }
    return {
      next: (t) => {
        if (list.length === 0) return null
        let i = resolveCursor(list, t)
        // The video jumped (moved from outside the reel, not by playing on): the
        // playhead is in the clip that shows that moment, if one does
        const last = lastSource.current
        lastSource.current = t
        if (
          (last === null || Math.abs(t - last) > JUMP) &&
          !inside(list[i], t)
        ) {
          const at = list.findIndex((clip) => inside(clip, t))
          if (at >= 0) i = at
        }
        if (list[i].id !== cursorRef.current) setCursor(list[i].id)
        const clip = list[i]
        if (inside(clip, t)) return undefined
        if (t < clip.start) return seekTo(clip.start)
        const next = list[i + 1]
        if (!next) return null
        setCursor(next.id)
        // Touching clips (a cut): no seek, no hitch
        return Math.abs(next.start - t) < EDGE_EPSILON
          ? undefined
          : seekTo(next.start)
      },
      rate: () => (list[resolveCursor(list, 0)]?.slow_mo ? 0.5 : 1),
      restart: () => {
        if (list.length === 0) return undefined
        setCursor(list[0].id)
        return seekTo(list[0].start)
      },
    }
  }

  /** Seeks while a handle moves: the latest position, at most every PREVIEW_SEEK_MS. */
  const previewSeek = useRef<{ last: number; timer?: number; t?: number }>({
    last: 0,
  })
  const seekRef = useRef(player.seek)
  seekRef.current = player.seek
  const preview = (t: number) => {
    const state = previewSeek.current
    state.t = t
    const run = () => {
      state.timer = undefined
      state.last = performance.now()
      if (state.t !== undefined) seekRef.current(state.t)
      state.t = undefined
    }
    const wait = PREVIEW_SEEK_MS - (performance.now() - state.last)
    if (wait <= 0) run()
    else if (state.timer === undefined)
      state.timer = window.setTimeout(run, wait)
  }
  const stopPreview = () => {
    window.clearTimeout(previewSeek.current.timer)
    previewSeek.current = { last: 0 }
  }
  /** While an overlay's edge or bar moves: the playhead follows it (throttled). */
  const previewReel = (t: number) => {
    const at = atReelTime(clips, t)
    if (!at) return
    if (clips[at.index].id !== cursorRef.current) setCursor(clips[at.index].id)
    lastSource.current = at.source
    preview(at.source)
  }

  // --- Previous / next -----------------------------------------------------------------
  const playSegment = (segment: Segment | undefined) => {
    if (!segment) return
    player.seek(segment.start)
    player.play()
  }
  const playClip = (clip: Clip | undefined) => {
    if (!clip) return
    seekClip(clip.id, clip.start)
    player.play()
  }
  // Highlights: ← / → go through the match's rallies. Edit: through the reel's clips.
  const goNext = () =>
    mode === "edit"
      ? playClip(clips[cursorIndex + 1])
      : playSegment(nextSegment(segments, player.currentTime()))
  const goPrevious = () => {
    if (mode !== "edit") {
      playSegment(previousSegment(segments, player.currentTime()))
      return
    }
    const into = cursorClip ? player.currentTime() - cursorClip.start : 0
    playClip(
      into > RESTART_AFTER
        ? cursorClip
        : (clips[cursorIndex - 1] ?? cursorClip),
    )
  }

  // The reel's clips as chapters in reel time (the full-screen chapter bar)
  const reelChapters = useMemo<Segment[]>(() => {
    const spans = reelSpans(clips)
    return clips.map((_, i) => ({
      number: i + 1,
      rally: {
        id: i + 1,
        number: i + 1,
        is_maybe: maybes[i],
        start: spans[i].start,
        end: spans[i].end,
        duration: spans[i].end - spans[i].start,
      },
      start: spans[i].start,
      end: spans[i].end,
    }))
  }, [clips, maybes])

  // What's on screen now: a slow-mo clip (Edit plays it slowly).
  const playingSlow = mode === "edit" && Boolean(cursorClip?.slow_mo)

  // --- Overlays (Edit): on the reel's timeline, drawn on the video -----------------
  // One can be selected (its tools replace the clip tools; selecting a clip brings
  // those back) and one typed into: a double-tapped one, or a new one (`draft`, not in
  // the edit list until it has text, so adding is one undo step).
  const [overlayId, setOverlayId] = useState<string | undefined>()
  const [typing, setTyping] = useState<{ id: string; draft?: Overlay }>()
  const selectedOverlay =
    edit.overlays.find((o) => o.id === overlayId) ??
    (typing?.draft?.id === overlayId ? typing?.draft : undefined)
  // Undone, deleted, or another mode: nothing selected
  useEffect(() => {
    if (overlayId && !selectedOverlay) setOverlayId(undefined)
  }, [overlayId, selectedOverlay])
  useEffect(() => {
    if (mode !== "edit") {
      setOverlayId(undefined)
      setTyping(undefined)
    }
  }, [mode])
  const shownOverlays =
    mode === "edit"
      ? [
          ...edit.overlays.filter(
            (o) => isActive(o, reelTime) || o.id === typing?.id,
          ),
          ...(typing?.draft ? [typing.draft] : []),
        ]
      : []

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

  /** One server call at a time. */
  const exclusive = async (work: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    setFixBusy(true)
    try {
      await work()
    } finally {
      busy.current = false
      setFixBusy(false)
    }
  }

  /**
   * Make a fix: refresh the rallies, one undo step, say what changed. The reel plays
   * the same footage; only labels of clips whose rally is gone change.
   */
  const runFix = (pending: NewFix) =>
    exclusive(async () => {
      const result = await applyFix(video.id, pending)
      const fix = { ...pending, after: result.ids } as RallyFix
      applyRallies(result.change)
      const now = presentEdit(historyRef.current)
      const clipsOfDeleted =
        fix.kind === "delete"
          ? now.segments.filter((c) => c.rally_id === fix.before[0]).length
          : 0
      dispatch({
        type: "fix",
        fix,
        edit: relabel(now, result.change.rallies),
      })
      toast.success(describeFix(fix, result.change), {
        description: describeImpact(fix, clipsOfDeleted),
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
      runFix({
        kind: "delete",
        before: [rally.id],
        from,
        maybe: isMaybe(rally),
      }).catch(fixFailed(`Couldn't delete rally ${segment.number}`))
    } else if (kind === "confirm") {
      runFix({ kind: "confirm", before: [rally.id] }).catch(
        fixFailed(`Couldn't keep rally ${segment.number}`),
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
      dispatch({ type: "undo-fix", ids: result.ids })
      toast.success("Rally fix undone", {
        description: "The chapters are updated too.",
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
      dispatch({ type: "redo-fix", ids: result.ids })
      toast.success(
        describeFix({ ...fix, after: result.ids } as RallyFix, result.change),
        {
          description: "Done again. The chapters are updated too.",
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
    const at = player.currentTime()
    if (!cursorClip || !canCut(cursorClip, at)) return
    const newId = newClipId(edit)
    dispatch({ type: "cut", id: cursorClip.id, at, newId })
    // The second part is selected (the playhead is at its start)
    setCursor(newId)
  }
  const onDelete = () => {
    if (!cursorClip) return
    dispatch({ type: "delete", id: cursorClip.id })
    // The playhead goes to the clip that takes its place (or the one before)
    const next = clips[cursorIndex + 1] ?? clips[cursorIndex - 1]
    if (next) seekClip(next.id, next.start)
    else setCursor(undefined)
  }
  const onSetBounds = (id: string, span: Span, edge: Edge) => {
    stopPreview()
    dispatch({ type: "set-bounds", id, span, duration })
    // The playhead on the edge that moved: the frame you were looking at stays
    const fitted = fitBounds(span, duration, edge === "start" ? "end" : "start")
    seekClip(
      id,
      edge === "start"
        ? fitted.start
        : Math.max(fitted.start, fitted.end - EDGE_EPSILON),
    )
  }

  // Add footage ("+" at the end of the clip track)
  const [addRange, setAddRange] = useState<Span | null>(null)
  /** Where the playhead was: the sheet's previews move the video, Cancel puts it back. */
  const beforeAdd = useRef<{ id: string; source: number } | null>(null)
  const openAdd = () => {
    player.pause()
    beforeAdd.current = cursorClip
      ? { id: cursorClip.id, source: player.currentTime() }
      : null
    const from = cursorClip ? cursorClip.end : player.currentTime()
    setAddRange(
      fitBounds({ start: from, end: from + ADD_FOOTAGE_SECONDS }, duration),
    )
  }
  const addFootage = (span: Span) => {
    stopPreview()
    beforeAdd.current = null
    const clip: Clip = {
      id: newClipId(edit),
      ...span,
      slow_mo: false,
      rally_id: rallyOver(span, rallyList),
    }
    // After the clip under the playhead
    dispatch({
      type: "insert",
      clip,
      index: cursorIndex >= 0 ? cursorIndex + 1 : clips.length,
    })
    seekClip(clip.id, clip.start)
  }

  // --- Overlay tools ----------------------------------------------------------------
  /** Inside an overlay: a little after its start (seeks can land a frame early). */
  const insideOf = (o: Span) => o.start + Math.min(0.1, (o.end - o.start) / 2)
  const selectOverlay = (id: string | undefined) => {
    setOverlayId(id)
    const overlay = edit.overlays.find((o) => o.id === id)
    // A bar tapped away from the playhead: go to it, so it shows on the video
    if (overlay && !isActive(overlay, reelTime)) seekReel(insideOf(overlay))
  }
  const onAddText = () => {
    if (edit.overlays.length >= MAX_OVERLAYS || clips.length === 0) return
    player.pause()
    const draft = newTextOverlay({
      id: newOverlayId(edit.overlays),
      at: reelTime,
      length: reelSeconds,
      text: "",
    })
    setOverlayId(draft.id)
    setTyping({ id: draft.id, draft })
  }
  const startTyping = (id: string) => {
    const overlay = edit.overlays.find((o) => o.id === id)
    if (overlay?.type !== "text") return
    player.pause()
    setOverlayId(id)
    setTyping({ id })
  }
  const finishTyping = (id: string, text: string | null) => {
    const current = typing
    if (!current || current.id !== id) return
    setTyping(undefined)
    const clean = text === null ? "" : cleanText(text)
    if (current.draft) {
      // A new text exists once it has some: one undo step
      if (clean)
        dispatch({
          type: "add-overlay",
          overlay: { ...current.draft, text: clean },
        })
      else setOverlayId(undefined)
      return
    }
    const overlay = edit.overlays.find((o) => o.id === id)
    if (overlay?.type === "text" && clean && clean !== overlay.text)
      dispatch({ type: "update-overlay", id, patch: { text: clean } })
  }
  /** Ends typing the way a tap elsewhere would (blur keeps the text). */
  const stopTyping = () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.isContentEditable) active.blur()
  }
  const onCutOverlay = () => {
    if (!selectedOverlay || !canCutOverlay(selectedOverlay, reelTime)) return
    const newId = newOverlayId(edit.overlays)
    dispatch({
      type: "cut-overlay",
      id: selectedOverlay.id,
      at: reelTime,
      newId,
    })
    setOverlayId(newId)
  }
  const onDeleteOverlay = () => {
    if (!selectedOverlay) return
    if (typing?.draft) {
      setTyping(undefined)
      setOverlayId(undefined)
      return
    }
    setTyping(undefined)
    dispatch({ type: "delete-overlay", id: selectedOverlay.id })
    setOverlayId(undefined)
  }
  const onSetOverlayTimes = (
    id: string,
    span: Span,
    how: "start" | "end" | "move",
  ) => {
    stopPreview()
    dispatch({ type: "set-overlay-times", id, span })
    // The playhead on what moved, inside the overlay (so it shows)
    const fitted = fitOverlaySpan(
      span,
      reelSeconds,
      how === "start" ? "end" : "start",
    )
    seekReel(
      how === "end"
        ? fitted.end - Math.min(0.1, (fitted.end - fitted.start) / 2)
        : insideOf(fitted),
    )
  }

  const pickRally = (rally: RallyPublic) =>
    dispatch({ type: "pick-rally", rally, duration })
  // Quick starts (Edit with nothing picked): one undo step each
  const pickAll = (list: RallyPublic[]) =>
    dispatch({ type: "pick-many", rallies: list, duration })
  // "Pick from the list": Highlights, with a hint about the circles and Picked
  const [pickHint, setPickHint] = useState(false)
  useEffect(() => {
    if (mode === "edit") setPickHint(false)
  }, [mode])

  // Stats over the sure rallies (maybes count once kept)
  const playTime = rallyTime(segments.filter((s) => !isMaybe(s.rally)))
  // Highlights only: in Edit the video shows the reel's clips, which are footage
  // (their edges can go anywhere), not rallies
  const rallyBadge = mode === "highlights" && current && (
    <RallyBadge number={current.number} total={segments.length} />
  )
  const inFullscreen = player.fullscreen.active
  // Skip breaks is the player's: in Edit the reel has no breaks to skip
  const pill = (className?: string) =>
    mode === "highlights" && (
      <SkipBreaksPill
        on={skipBreaks}
        onToggle={() => setSkipBreaks((on) => !on)}
        className={className}
      />
    )
  const isPicked = useCallback(
    (rally: RallyPublic) => isRallyPicked(edit, rally.id),
    [edit],
  )
  const pickedCount = segments.filter((s) => isPicked(s.rally)).length
  /** Seconds of the rally in this reel, when it's less than a new clip of it (cut). */
  const keptOf = (rally: RallyPublic) => {
    const own = clips.filter((clip) => clip.rally_id === rally.id)
    if (own.length === 0) return undefined
    const kept = own.reduce((sum, clip) => sum + clip.end - clip.start, 0)
    const whole = paddedRally(rally, duration)
    return kept < whole.end - whole.start - 0.05 ? kept : undefined
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        // Phones held upright: one screen like the prototypes, the viewport's height
        // below the status bar (h-page: dvh, so iOS Safari's toolbar doesn't make it
        // overflow). The top half
        // (header, video, controls, mode toggle) keeps its size; the mode's panel
        // takes the rest, with its tools / bottom bar at the bottom. The page never
        // scrolls: only the rally list and the timeline do.
        "max-md:portrait:-m-4 max-md:portrait:h-page max-md:portrait:overflow-hidden",
      )}
    >
      <ScreenHeader
        video={video}
        title={title}
        summary={
          mode === "edit"
            ? {
                kind: "reel",
                clips: clips.length,
                seconds: reelSeconds,
              }
            : {
                kind: "match",
                rallyCount: sureRallies.length,
                maybeCount,
                playTime,
              }
        }
        beforeReanalyze={autosave.flush}
        exporting={reelExports.active}
        onExport={() => setExportOpen(true)}
        // Nothing to say about saving until there's a reel (or a change to save)
        saveStatus={
          autosave.exists || autosave.status !== "saved"
            ? autosave.status
            : undefined
        }
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
              {mode === "edit" && (
                <OverlayLayer
                  overlays={shownOverlays}
                  format={edit.format}
                  selectedId={overlayId}
                  editingId={typing?.id}
                  interactive={!inFullscreen}
                  onSelect={(id) => {
                    if (typing && id !== typing.id) stopTyping()
                    setOverlayId(id)
                  }}
                  onChange={(id, patch) =>
                    dispatch({ type: "update-overlay", id, patch })
                  }
                  onGestureStart={player.pause}
                  onStartEdit={startTyping}
                  onFinishEdit={finishTyping}
                />
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
                  // The reel's clips as chapters, in reel time
                  <RallyScrubber
                    duration={reelSeconds}
                    time={reelTime}
                    segments={reelChapters}
                    visibleNumbers={
                      new Set(reelChapters.map((chapter) => chapter.number))
                    }
                    currentNumber={cursorIndex + 1}
                    onSeek={(t) => {
                      const at = atReelTime(clips, t)
                      if (at) seekClip(clips[at.index].id, at.source)
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
                  (mode === "edit" ? clips : segments).length > 0
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

      {mode === "highlights" ? (
        // The player: the match's chapters, the stats, rally controls. Hidden (not
        // removed) in full screen, so the layout behind stays put.
        <div className={cn(inFullscreen && "invisible")}>
          <div className="px-4 pt-1.5 md:px-0">
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
          <div className="grid grid-cols-3 gap-2 px-4 pt-1 pb-1.5 md:px-0">
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
          <ControlRow
            time={time}
            duration={duration}
            paused={paused}
            canPlay={Boolean(src)}
            canNavigate={Boolean(src) && segments.length > 0}
            onPrevious={goPrevious}
            onTogglePlay={player.togglePlay}
            onNext={goNext}
            className="pr-1.5 pl-4 md:px-0"
            trailing={
              <>
                <ControlButton
                  label="Undo"
                  title="Undo (⌘Z)"
                  onClick={() => void undo()}
                  disabled={!canUndo(history) || fixBusy}
                >
                  <Undo2 className="size-5" />
                </ControlButton>
                <ControlButton
                  ref={player.fullscreen.triggerRef}
                  label="Full screen"
                  onClick={player.fullscreen.enter}
                  disabled={!src}
                >
                  <FullscreenIcon className="size-5" />
                </ControlButton>
              </>
            }
          />
        </div>
      ) : (
        /* Edit: the time row (reel time · play · undo · redo · format · full screen) */
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
      )}

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
          pickedCount={pickedCount}
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
          pickHint={pickHint}
          onDismissHint={() => setPickHint(false)}
          notice={
            <>
              {rallies.isError && (
                <Alert
                  variant="destructive"
                  className="mx-4 mb-2 w-auto md:mx-0"
                >
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
              )}
              {video.court_out_of_frame && (
                <Alert className="mx-4 mb-2 w-auto px-3 py-2 md:mx-0">
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
            </>
          }
        />
      ) : clips.length === 0 ? (
        // Quick starts take the sure rallies only: a maybe joins once it's kept (or
        // picked by hand)
        <EmptyReel
          rallyCount={sureRallies.length}
          maybeCount={maybeCount}
          onLongest={() => pickAll(longestRallies(sureRallies))}
          onAll={() => pickAll(sureRallies)}
          onPickFromList={() => {
            setPickHint(true)
            onModeChange("highlights")
          }}
        />
      ) : (
        <EditPanel
          edit={edit}
          rallies={rallyList}
          duration={duration}
          reelTime={reelTime}
          // An overlay selected: its handles, not the clip's
          selectedId={overlayId ? undefined : cursorClip?.id}
          selectedOverlayId={overlayId}
          atOverlayLimit={edit.overlays.length >= MAX_OVERLAYS}
          thumbs={thumbs}
          callbacks={{
            onScrubStart: player.pause,
            onScrub: (index, source) => {
              const clip = clips[index]
              if (clip) seekClip(clip.id, source)
            },
            // A clip tapped: the clip tools again
            onSelect: (id, source) => {
              if (typing) stopTyping()
              setOverlayId(undefined)
              seekClip(id, source)
            },
            onEdgeDragStart: player.pause,
            onPreview: preview,
            onSetBounds,
            onMove: (id, to) => dispatch({ type: "move", id, to }),
            onAdd: openAdd,
            onMoveStart: player.pause,
            // Dropped (or not): that clip is selected, the playhead at its start
            onMoveEnd: (id) => {
              setOverlayId(undefined)
              const moved = clips.find((clip) => clip.id === id)
              if (moved) seekClip(moved.id, moved.start)
            },
            onSelectOverlay: (id) => {
              if (typing && typing.id !== id) stopTyping()
              selectOverlay(id)
            },
            onOverlayDragStart: player.pause,
            onOverlayPreview: previewReel,
            onSetOverlayTimes,
          }}
        >
          {selectedOverlay ? (
            <OverlayTools
              canCut={!typing && canCutOverlay(selectedOverlay, reelTime)}
              onEditText={() =>
                typing ? undefined : startTyping(selectedOverlay.id)
              }
              onCut={onCutOverlay}
              onDelete={onDeleteOverlay}
              onDone={() => {
                if (typing) stopTyping()
                setOverlayId(undefined)
              }}
            />
          ) : (
            <EditTools
              format={edit.format}
              clip={cursorClip}
              name={`clip ${cursorIndex + 1}`}
              canCut={canCut(cursorClip, time)}
              canAddText={edit.overlays.length < MAX_OVERLAYS}
              onCut={onCut}
              onDelete={onDelete}
              onToggleSlowMo={() =>
                cursorClip &&
                dispatch({ type: "toggle-slow-mo", id: cursorClip.id })
              }
              onAddText={onAddText}
              onToggleFormat={() =>
                dispatch({
                  type: "set-format",
                  format: edit.format === "16:9" ? "9:16" : "16:9",
                })
              }
            />
          )}
        </EditPanel>
      )}

      <AddFootageSheet
        open={addRange !== null}
        onOpenChange={(open) => {
          if (!open) {
            stopPreview()
            setAddRange(null)
            const back = beforeAdd.current
            beforeAdd.current = null
            if (back) seekClip(back.id, back.source)
          }
        }}
        duration={duration}
        segments={segments}
        thumbs={thumbs}
        initial={addRange ?? { start: 0, end: ADD_FOOTAGE_SECONDS }}
        onPreview={preview}
        onAdd={addFootage}
      />
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
      <ExportSheet
        open={exportOpen}
        onOpenChange={setExportOpen}
        video={video}
        reel={{
          seconds: reelSeconds,
          clips: clips.length,
          format: edit.format,
        }}
        exports={reelExports}
      />
    </div>
  )
}

/** What the header's second line sums up: the match (Highlights) or the reel (Edit). */
type Summary =
  | { kind: "match"; rallyCount: number; maybeCount: number; playTime: number }
  | { kind: "reel"; clips: number; seconds: number }

/**
 * Back to Home, the video's title, "68 rallies · 18:20 play · 5 to check" (Edit:
 * "7 clips · 1:24") (+ the reel's save state once there is one), Export (with the running export's progress
 * on it) and a menu (re-analyze with a newer detector, re-mark court, delete).
 */
function ScreenHeader({
  video,
  title,
  summary,
  saveStatus,
  onRetrySave,
  beforeReanalyze,
  exporting,
  onExport,
}: {
  video: VideoPublic
  title: string
  /** Match: sure rallies (maybes not counted until kept). */
  summary: Summary
  saveStatus: SaveStatus | undefined
  onRetrySave: () => void
  beforeReanalyze: () => Promise<void>
  /** An export of the reel that is queued or rendering: its progress on the button. */
  exporting: ExportPublic | undefined
  onExport: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 py-2 pr-1 pl-1 md:mb-4 md:h-auto md:p-0">
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-md md:-ml-3"
      >
        <Link to="/" aria-label="Back to Home">
          <ChevronLeft className="size-[22px]" />
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-[15px] font-extrabold md:text-[26px] md:tracking-[-0.01em]">
          {title}
        </h1>
        {/* On a phone the summary gives way first: the save state (and its Retry)
            must stay visible */}
        <p className="flex min-w-0 text-xs text-muted-foreground tabular-nums md:text-[13px]">
          {summary.kind === "reel" ? (
            <span data-testid="reel-summary" className="truncate">
              {summary.clips} {summary.clips === 1 ? "clip" : "clips"} ·{" "}
              {formatDuration(summary.seconds)}
            </span>
          ) : (
            <span data-testid="match-summary" className="truncate">
              {summary.rallyCount}{" "}
              {summary.rallyCount === 1 ? "rally" : "rallies"} ·{" "}
              {formatDuration(summary.playTime)} play
              {summary.maybeCount > 0 && (
                <>
                  {" · "}
                  <span className="font-bold text-subtle-foreground">
                    {summary.maybeCount} to check
                  </span>
                </>
              )}
            </span>
          )}
          {saveStatus && (
            <span className="shrink-0 whitespace-pre">
              {" · "}
              <SaveIndicator status={saveStatus} onRetry={onRetrySave} />
            </span>
          )}
        </p>
      </div>
      <Button
        size="sm"
        onClick={onExport}
        aria-label={
          exporting
            ? `Export, ${Math.round(exporting.progress * 100)}% exported`
            : "Export"
        }
        className="relative shrink-0"
      >
        <Upload />
        Export
        {exporting && (
          // Progress while it renders, also with the sheet closed
          <span
            data-testid="export-badge"
            className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[10px] font-extrabold text-background tabular-nums ring-2 ring-background"
          >
            {Math.round(exporting.progress * 100)}%
          </span>
        )}
      </Button>
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
          {video.detector_outdated && (
            <DropdownMenuItem onSelect={() => setReanalyzing(true)}>
              <Sparkles />
              Re-analyze with the latest detector
            </DropdownMenuItem>
          )}
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
      <ReanalyzeDialog
        video={video}
        open={reanalyzing}
        onOpenChange={setReanalyzing}
        beforeReanalyze={beforeReanalyze}
      />
    </header>
  )
}

/** One box of the stats strip under the chapters. */
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
    <div className="flex min-w-0 flex-col rounded-md bg-card px-2.5 py-1.5">
      <span className="truncate text-[11px] font-bold text-muted-foreground">
        {label}
      </span>
      <span
        className={cn("text-lg font-extrabold tabular-nums", valueClassName)}
      >
        {value}
      </span>
    </div>
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
      if (
        target.closest(
          "input, textarea, [contenteditable]:not([contenteditable='false'])",
        )
      )
        return
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
