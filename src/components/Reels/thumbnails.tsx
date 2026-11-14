import { queryOptions, useQuery } from "@tanstack/react-query"
import { AxiosError } from "axios"
import { type CSSProperties, useEffect, useRef, useState } from "react"

import { VideosService } from "@/client"
import { parseApiDate } from "@/lib/format"
import { cn } from "@/lib/utils"

// The thumbnail strip (GET /videos/{id}/thumbnails-url): one small frame per second,
// packed into sprite sheets of columns × rows tiles. A tile is drawn as a CSS
// background (the sheet, scaled, positioned on that tile), so the browser loads each
// sheet once, and only for tiles actually on screen.

const API_URL = import.meta.env.VITE_API_URL ?? ""

type ThumbIndex = {
  interval: number
  count: number
  tile_width: number
  tile_height: number
  columns: number
  rows: number
  sheets: string[]
}

export type Thumbnails = { index: ThumbIndex; sheetUrls: string[] }

export const isThumbnailsMissing = (error: unknown) =>
  error instanceof AxiosError &&
  error.response?.status === 404 &&
  error.response.data?.code === "thumbnails_missing"

/** Get new links this long before the old ones (12 h) expire. */
const RENEW_MS = 10 * 60_000

export function thumbnailsQueryOptions(videoId: string) {
  return queryOptions({
    queryKey: ["videos", videoId, "thumbnails"],
    queryFn: async () => {
      const { data } = await VideosService.readVideoThumbnailsUrl({
        path: { id: videoId },
      })
      // The index is a signed static file, like the video: no login header needed.
      const response = await fetch(`${API_URL}${data.index_url}`)
      if (!response.ok) throw new Error("Couldn't load the thumbnails")
      return {
        index: (await response.json()) as ThumbIndex,
        sheetUrls: data.sheet_urls.map((url) => `${API_URL}${url}`),
        expiresAt: data.expires_at,
      }
    },
    staleTime: (query) =>
      query.state.data
        ? Math.max(
            0,
            parseApiDate(query.state.data.expiresAt).getTime() -
              Date.now() -
              RENEW_MS,
          )
        : 0,
    // Analyzed before thumbnails existed: an answer, not a hiccup.
    retry: (count, error) => !isThumbnailsMissing(error) && count < 2,
    refetchOnWindowFocus: false,
  })
}

/** The strip, or undefined while loading / when the video has none (plain fallback). */
export function useThumbnails(videoId: string): Thumbnails | undefined {
  return useQuery(thumbnailsQueryOptions(videoId)).data
}

/**
 * Background for one tile: the frame nearest `t`, scaled to `height`, centered in a
 * box `width` wide (wider frames are cropped at the sides).
 */
export function tileStyle(
  thumbs: Thumbnails,
  t: number,
  height: number,
  width: number,
): CSSProperties {
  const { index, sheetUrls } = thumbs
  const tile = Math.min(
    index.count - 1,
    Math.max(0, Math.floor(t / index.interval)),
  )
  const perSheet = index.columns * index.rows
  const sheet = Math.floor(tile / perSheet)
  const within = tile % perSheet
  const column = within % index.columns
  const row = Math.floor(within / index.columns)
  const scale = height / index.tile_height
  const tileWidth = index.tile_width * scale
  return {
    backgroundImage: `url("${sheetUrls[sheet]}")`,
    backgroundSize: `${index.columns * tileWidth}px ${index.rows * height}px`,
    backgroundPosition: `${-column * tileWidth + (width - tileWidth) / 2}px ${-row * height}px`,
    backgroundRepeat: "no-repeat",
  }
}

/** Width of one frame on the timeline (a 60 px tall frame, center-cropped). */
const SLOT = 60

/**
 * Frames along a timeline item: one per 60 px, each the moment under its middle.
 * Only slots inside `visible` (x in the item's own coordinates) are drawn.
 */
export function ThumbStrip({
  thumbs,
  src,
  width,
  height = 60,
  visible,
  className,
}: {
  thumbs: Thumbnails
  src: { start: number; end: number }
  width: number
  height?: number
  visible: { from: number; to: number }
  className?: string
}) {
  const slots: { x: number; w: number; t: number }[] = []
  const first = Math.max(0, Math.floor(visible.from / SLOT))
  const last = Math.min(Math.ceil(width / SLOT), Math.ceil(visible.to / SLOT))
  for (let k = first; k < last; k++) {
    const x = k * SLOT
    const w = Math.min(SLOT, width - x)
    if (w <= 0) break
    const middle = (x + w / 2) / width
    slots.push({ x, w, t: src.start + middle * (src.end - src.start) })
  }
  return (
    <span aria-hidden="true" className={cn("absolute inset-0", className)}>
      {slots.map((slot) => (
        <span
          key={slot.x}
          data-testid="thumb"
          className="absolute top-0"
          style={{
            left: slot.x,
            width: slot.w,
            height,
            ...tileStyle(thumbs, slot.t, height, slot.w),
          }}
        />
      ))}
    </span>
  )
}

/** One frame in a fixed box (a rally row's 72×40), loaded once it scrolls into view. */
export function FrameThumb({
  thumbs,
  t,
  width,
  height,
  className,
}: {
  thumbs: Thumbnails
  t: number
  width: number
  height: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || seen) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { rootMargin: "200px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-testid={seen ? "thumb" : undefined}
      className={cn("absolute inset-0", className)}
      style={seen ? tileStyle(thumbs, t, height, width) : undefined}
    />
  )
}
