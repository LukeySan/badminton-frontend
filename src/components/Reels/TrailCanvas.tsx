import { type RefObject, useEffect, useRef } from "react"

import type { TrajectoryPoint } from "@/client"
import { TRAIL_SECONDS } from "./trajectory"

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** Consecutive points further apart than this (frames) aren't joined: unseen. */
const MAX_FRAME_GAP = 3

/**
 * The shuttle's last ~0.6 s drawn over the video, fading out, with its head marked.
 * Redrawn for every video frame (requestVideoFrameCallback gives the frame's exact
 * time); browsers without it use timeupdate plus animation frames while playing.
 * Positions are fractions of the video frame, mapped through the same contain/cover
 * fit as the <video>, so the trail stays on the shuttle in a cropped 9:16 reel too.
 */
export function TrailCanvas({
  videoRef,
  src,
  points,
  videoAspect,
  cover,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The <video> appears (and can change) with its source: set up again then. */
  src: string | undefined
  points: TrajectoryPoint[]
  videoAspect: number
  /** The video fills the frame and is cropped (object-cover). */
  cover: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ points, videoAspect, cover })
  latest.current = { points, videoAspect, cover }
  const redrawRef = useRef<(() => void) | null>(null)

  // Set up again when the <video> appears or gets a new source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: src picks the element up
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current as VideoWithFrames | null
    if (!canvas || !video) return
    const context = canvas.getContext("2d")
    if (!context) return

    const draw = (mediaTime: number) => {
      const { points, videoAspect, cover } = latest.current
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      // Where the video's picture is inside the frame (contain or cover)
      const scale = cover
        ? Math.max(width / videoAspect, height)
        : Math.min(width / videoAspect, height)
      const pictureW = videoAspect * scale
      const pictureH = scale
      const left = (width - pictureW) / 2
      const top = (height - pictureH) / 2
      const at = (p: TrajectoryPoint) =>
        [left + (p.x ?? 0) * pictureW, top + (p.y ?? 0) * pictureH] as const

      const recent = points.filter(
        (p) =>
          p.visible &&
          p.x !== null &&
          p.y !== null &&
          p.t <= mediaTime + 1e-3 &&
          p.t >= mediaTime - TRAIL_SECONDS,
      )
      if (recent.length === 0) return

      const styles = getComputedStyle(canvas)
      const trail = styles.getPropertyValue("--court-foreground").trim()
      const ring = styles.getPropertyValue("--highlight").trim()
      const unit = Math.max(1, width / 390) // thicker on bigger frames
      context.lineCap = "round"
      context.strokeStyle = trail
      for (let i = 1; i < recent.length; i++) {
        const a = recent[i - 1]
        const b = recent[i]
        if (b.frame - a.frame > MAX_FRAME_GAP) continue
        const fade = 1 - (mediaTime - b.t) / TRAIL_SECONDS
        const [ax, ay] = at(a)
        const [bx, by] = at(b)
        // Soft glow, then the line itself
        context.globalAlpha = 0.18 * fade
        context.lineWidth = 9 * unit
        context.beginPath()
        context.moveTo(ax, ay)
        context.lineTo(bx, by)
        context.stroke()
        context.globalAlpha = fade
        context.lineWidth = 3 * unit
        context.beginPath()
        context.moveTo(ax, ay)
        context.lineTo(bx, by)
        context.stroke()
      }
      // The shuttle now: a dot ringed in pink (only if it was just seen)
      const head = recent[recent.length - 1]
      if (mediaTime - head.t < 0.1) {
        const [hx, hy] = at(head)
        context.globalAlpha = 1
        context.fillStyle = trail
        context.strokeStyle = ring
        context.lineWidth = 2 * unit
        context.beginPath()
        context.arc(hx, hy, 5 * unit, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }

    let handle = 0
    let frame = 0
    let stopped = false
    const perFrame = typeof video.requestVideoFrameCallback === "function"
    const onVideoFrame = (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return
      draw(meta.mediaTime)
      handle = video.requestVideoFrameCallback!(onVideoFrame)
    }
    const onAnimationFrame = () => {
      if (stopped || video.paused) return
      draw(video.currentTime)
      frame = requestAnimationFrame(onAnimationFrame)
    }
    const redraw = () => draw(video.currentTime)
    redrawRef.current = redraw
    const onPlay = () => {
      if (!perFrame) frame = requestAnimationFrame(onAnimationFrame)
    }
    if (perFrame) handle = video.requestVideoFrameCallback!(onVideoFrame)
    else if (!video.paused) onPlay()
    // Paused seeks (scrubbing the timeline) and resizes need a redraw too.
    video.addEventListener("seeked", redraw)
    video.addEventListener("timeupdate", redraw)
    video.addEventListener("play", onPlay)
    const observer = new ResizeObserver(redraw)
    observer.observe(canvas)
    redraw()
    return () => {
      stopped = true
      if (perFrame) video.cancelVideoFrameCallback?.(handle)
      cancelAnimationFrame(frame)
      video.removeEventListener("seeked", redraw)
      video.removeEventListener("timeupdate", redraw)
      video.removeEventListener("play", onPlay)
      observer.disconnect()
      redrawRef.current = null
    }
  }, [videoRef, src])

  // New points (a chunk arrived), or a new fit: draw now, not at the next frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw reads the latest values
  useEffect(() => {
    redrawRef.current?.()
  }, [points, videoAspect, cover])

  return (
    <canvas
      ref={canvasRef}
      data-testid="trail"
      className="pointer-events-none absolute inset-0 size-full"
    />
  )
}
