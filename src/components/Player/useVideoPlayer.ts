import { useQuery } from "@tanstack/react-query"
import { type SyntheticEvent, useEffect, useRef, useState } from "react"

import type { VideoPublic } from "@/client"
import { fileUrlQueryOptions } from "@/components/Videos/queries"
import { skipTarget } from "./rallies"
import { useFullscreenPlayer } from "./useFullscreenPlayer"

// Same base as the API client (src/main.tsx); file-url returns a path.
const API_URL = import.meta.env.VITE_API_URL ?? ""

/**
 * What plays: only these stretches of the video, in order (null: all of it), and
 * how fast at each moment (slow-mo). The player's skip-breaks is spans = rallies; the
 * highlight editor's preview is spans = the reel's clips (and kept footage).
 */
export type PlaybackRule = {
  spans: { start: number; end: number }[] | null
  rateAt?: (t: number) => number
}

/**
 * Everything about playing one video, shared by the player and the highlight
 * editor: the signed URL (renewed on expiry, with the position kept), the <video>
 * element's state, seeking, skip-breaks and our own full screen. Render it with
 * <VideoStage>; the page decides the controls and what "next" means.
 */
export function useVideoPlayer(
  video: VideoPublic,
  {
    landscape,
    playback,
  }: {
    /** Full screen asks for landscape (the frame is wider than tall). */
    landscape: boolean
    /** Read on every frame while playing, so it can use values computed after this hook. */
    playback: () => PlaybackRule
  },
) {
  const fileUrl = useQuery(fileUrlQueryOptions(video.id))
  const videoRef = useRef<HTMLVideoElement>(null)

  // Mirrors of the <video> element's state, updated from its events.
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)
  // Rally times come from the API's timeline, so its duration is the reference.
  const duration = video.duration || mediaDuration

  const rule = useRef(playback)
  rule.current = playback
  const scrubbingRef = useRef(scrubbing)
  scrubbingRef.current = scrubbing

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
  const play = () => {
    const element = videoRef.current
    if (!element) return
    // Past the last stretch that plays (end of the reel): start again from the top.
    const { spans } = rule.current()
    if (spans?.length && skipTarget(spans, element.currentTime) === null) {
      seek(spans[0].start)
    }
    element.play().catch(() => {})
  }
  const pause = () => videoRef.current?.pause()
  const togglePlay = () => {
    const element = videoRef.current
    if (!element) return
    if (element.paused) play()
    else element.pause()
  }
  /** The element's time: state lags up to one timeupdate behind. */
  const currentTime = () => videoRef.current?.currentTime ?? time

  /**
   * The playback rule: outside the stretches that play, jump to the next one (or stop
   * after the last); inside, play at the rule's speed.
   */
  const enforcePlayback = (t: number) => {
    const element = videoRef.current
    if (!element || element.paused) return
    const { spans, rateAt } = rule.current()
    const rate = rateAt?.(t) ?? 1
    if (element.playbackRate !== rate) element.playbackRate = rate
    if (!spans || scrubbingRef.current) return
    const target = skipTarget(spans, t)
    if (target === undefined) return
    if (target === null) element.pause()
    else seek(target)
  }
  const enforceRef = useRef(enforcePlayback)
  enforceRef.current = enforcePlayback

  // While playing, check every frame (requestVideoFrameCallback; rAF where it's
  // missing): timeupdate alone fires ~4 times a second, so up to ¼ s of a cut break
  // would show before the jump.
  useEffect(() => {
    const element = videoRef.current as
      | (HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number
          cancelVideoFrameCallback?: (handle: number) => void
        })
      | null
    if (!element || paused) return
    const perFrame = typeof element.requestVideoFrameCallback === "function"
    let handle = 0
    let stopped = false
    const tick = () => {
      if (stopped) return
      enforceRef.current(element.currentTime)
      handle = perFrame
        ? element.requestVideoFrameCallback!(tick)
        : requestAnimationFrame(tick)
    }
    tick()
    return () => {
      stopped = true
      if (perFrame) element.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
    }
  }, [paused])

  // --- <video> event handlers -------------------------------------------------
  type VideoEvent = SyntheticEvent<HTMLVideoElement>
  const handlers = {
    onLoadedMetadata: () => {
      const element = videoRef.current!
      setMediaDuration(element.duration)
      if (resume.current) {
        element.currentTime = resume.current.time
        if (resume.current.play) element.play().catch(() => {})
        resume.current = null
      }
    },
    onLoadedData: () => {
      retriedError.current = false
      setPlaybackError(false)
    },
    onTimeUpdate: (event: VideoEvent) => {
      const t = event.currentTarget.currentTime
      lastTime.current = t
      setTime(t)
      enforcePlayback(t)
    },
    onSeeked: (event: VideoEvent) => setTime(event.currentTarget.currentTime),
    onPlay: (event: VideoEvent) => {
      wasPlaying.current = true
      setPaused(false)
      enforcePlayback(event.currentTarget.currentTime)
    },
    onPause: () => {
      wasPlaying.current = false
      setPaused(true)
    },
    onEnded: () => setPaused(true),
    onError: () => {
      // An expired link fails as a network/source error. Get a fresh link once.
      if (!retriedError.current) {
        retriedError.current = true
        resume.current = { time: lastTime.current, play: wasPlaying.current }
        fileUrl.refetch()
      } else {
        setPlaybackError(true)
      }
    },
  }

  /** "Try again" after a playback error: a new link, back to the same spot. */
  const retryPlayback = () => {
    setPlaybackError(false)
    retriedError.current = false
    resume.current = { time: lastTime.current, play: wasPlaying.current }
    fileUrl.refetch()
  }

  // --- Full screen (our own layer; see useFullscreenPlayer) ---------------------
  const fullscreen = useFullscreenPlayer({ landscape })
  // Inline the controls are always shown; in full screen they fade during playback.
  const showControls =
    !fullscreen.active || fullscreen.controlsAwake || paused || scrubbing

  return {
    video,
    videoRef,
    fileUrl,
    src,
    time,
    paused,
    duration,
    scrubbing,
    setScrubbing,
    playbackError,
    retryPlayback,
    seek,
    play,
    pause,
    togglePlay,
    currentTime,
    handlers,
    fullscreen,
    showControls,
  }
}

export type VideoPlayer = ReturnType<typeof useVideoPlayer>
