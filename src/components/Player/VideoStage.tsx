import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import { PlayerMessage } from "./controls"
import type { VideoPlayer } from "./useVideoPlayer"

/**
 * The one <video> of a page, inline and in our own full screen (CLAUDE.md: never
 * the browser's native video full screen for previews).
 *
 * React renders the video frame into `videoHost`, a DOM node made once, and that
 * node is moved between the inline slot and the full-screen slot. Moving a playing
 * <video> keeps it playing (browsers only pause it if it's still out of the document
 * after the current task), so entering or leaving full screen never reloads the
 * file, loses the position, or asks for a new signed URL.
 */
export function VideoStage({
  player,
  title,
  aspect,
  maxInlineHeight,
  cropToFrame = false,
  className,
  inlineOverlays,
  frameOverlays,
  fullscreenBadge,
  fullscreenTop,
  fullscreenBottom,
}: {
  player: VideoPlayer
  /** For the full-screen dialog's name: "<title>, full screen". */
  title: string
  /** The frame's shape (the video's, or the reel format's). */
  aspect: number
  /** Inline, the frame is never taller than this (CSS length, e.g. "70dvh"). */
  maxInlineHeight: string
  /** Fill the frame and crop the video (a 9:16 reel from 16:9 footage). */
  cropToFrame?: boolean
  /** On the inline slot (rounding, background). */
  className?: string
  /** Inline only, on the video: e.g. the rally badge and the skip pill. */
  inlineOverlays?: ReactNode
  /** Both modes, lined up with the picture (shuttle trail, captions). */
  frameOverlays?: ReactNode
  /** Full screen, top-left; stays while the controls fade. */
  fullscreenBadge?: ReactNode
  /** Full screen, top-right, fades with the controls. */
  fullscreenTop?: ReactNode
  /** Full screen, bottom (chapter bar + controls), fades with the controls. */
  fullscreenBottom: ReactNode
}) {
  const { fullscreen, showControls, src, fileUrl } = player

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

  // The frame: rendered into videoHost, so it moves between the modes. Overlays
  // that must line up with the picture go here: the frame always has its exact
  // shape.
  const frame = (
    <div className="relative size-full overflow-hidden">
      {src ? (
        <video
          ref={player.videoRef}
          src={src}
          // Inline playback, no native controls: iOS must never switch to its own
          // full-screen player (CLAUDE.md).
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          className={cn("size-full", cropToFrame && "object-cover")}
          data-testid="video"
          onClick={() => {
            // Full screen with the controls hidden: the first tap only shows them.
            if (!showControls) return fullscreen.wakeControls()
            player.togglePlay()
            if (fullscreen.active) fullscreen.wakeControls()
          }}
          {...player.handlers}
        />
      ) : fileUrl.isError ? (
        <PlayerMessage
          text={`Couldn't get the video link: ${extractErrorMessage(fileUrl.error)}`}
          onRetry={() => fileUrl.refetch()}
        />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}

      {frameOverlays}
      {!fullscreen.active && inlineOverlays}

      {player.playbackError && (
        <PlayerMessage
          text="This video can't be played right now."
          onRetry={player.retryPlayback}
        />
      )}
    </div>
  )

  return (
    <>
      {createPortal(frame, videoHost)}

      {/* Inline slot: keeps its size while the frame is in full screen, so the page
          behind doesn't jump */}
      <div
        ref={inlineSlotRef}
        className={cn("relative mx-auto overflow-hidden bg-court", className)}
        style={{
          aspectRatio: aspect,
          width: `min(100%, calc(${maxInlineHeight} * ${aspect}))`,
        }}
      />

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

            {/* Top: gradient + (e.g.) the skip pill, fading with the controls */}
            <div
              inert={!showControls}
              onPointerDownCapture={fullscreen.wakeControls}
              className={cn(
                "absolute inset-x-0 top-0 flex justify-end bg-linear-to-b from-letterbox/75 via-letterbox/35 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-10 pl-[max(1rem,env(safe-area-inset-left))] transition-opacity duration-300",
                showControls ? "opacity-100" : "opacity-0",
              )}
            >
              {fullscreenTop}
            </div>
            {/* The badge stays while watching: it says what you're looking at */}
            {fullscreenBadge && (
              <div className="pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] flex h-11 items-center">
                {fullscreenBadge}
              </div>
            )}

            {/* Bottom: gradient + chapter bar + controls */}
            <div
              inert={!showControls}
              onPointerDownCapture={fullscreen.wakeControls}
              className={cn(
                "absolute inset-x-0 bottom-0 bg-linear-to-t from-letterbox/90 via-letterbox/60 to-transparent pt-12 pr-[max(0.375rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] transition-opacity duration-300",
                showControls ? "opacity-100" : "opacity-0",
              )}
            >
              {fullscreenBottom}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
