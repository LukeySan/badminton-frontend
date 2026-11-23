import { queryOptions } from "@tanstack/react-query"

import { type ExportPublic, ExportsService, type VideoPublic } from "@/client"
import { parseApiDate } from "@/lib/format"

// Reel exports: the video's reel rendered into an MP4 by the worker. What's rendered
// is fixed when the export is requested (later edits don't change it): the reel's
// clips in list order, as Edit plays them. Query keys: the video's exports
// ["videos", id, "exports"] (under the video, so deleting it drops them), a finished
// export's signed link ["exports", id, "download"] and its file ["exports", id, "file"].

const API_URL = import.meta.env.VITE_API_URL ?? ""

/** How often to ask for news while an export is queued or rendering. */
export const EXPORT_POLL_MS = 2000

export type ExportQuality = ExportPublic["quality"]

export const isExportActive = (e: Pick<ExportPublic, "status">) =>
  e.status === "queued" || e.status === "processing"

/** The video's exports, newest first. Polls only while one is queued or rendering. */
export function videoExportsQueryOptions(videoId: string) {
  return queryOptions({
    queryKey: ["videos", videoId, "exports"],
    queryFn: async () =>
      (await ExportsService.readVideoExports({ path: { id: videoId } })).data,
    refetchInterval: (query) =>
      query.state.data?.data.some(isExportActive) ? EXPORT_POLL_MS : false,
  })
}

/** Get a new link this long before the old one expires. */
const LINK_RENEW_MS = 5 * 60_000

/**
 * A finished export's signed link (absolute URL), for the preview, Download and
 * Share. The <video> tag and a plain link can't send the login header.
 */
export function exportLinkQueryOptions(exportId: string) {
  return queryOptions({
    queryKey: ["exports", exportId, "download"],
    queryFn: async () => {
      const link = (
        await ExportsService.readExportDownload({
          path: { export_id: exportId },
        })
      ).data
      return { ...link, url: `${API_URL}${link.url}` }
    },
    // Each fetch is a new URL, and a new URL reloads the preview: keep one until
    // shortly before it expires.
    staleTime: (query) =>
      query.state.data
        ? Math.max(
            0,
            parseApiDate(query.state.data.expires_at).getTime() -
              Date.now() -
              LINK_RENEW_MS,
          )
        : 0,
  })
}

/**
 * The finished MP4 itself, for the Web Share API (it shares files, not links). Read
 * ahead while the export is on screen: Safari only lets a tap share for a moment,
 * too short to download the file first.
 */
export function exportFileQueryOptions(
  exportId: string,
  url: string | undefined,
) {
  return queryOptions({
    queryKey: ["exports", exportId, "file"],
    queryFn: async () => {
      const response = await fetch(url!)
      if (!response.ok) throw new Error(`Download failed (${response.status})`)
      return response.blob()
    },
    enabled: Boolean(url),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60_000, // a video file: don't keep it around once nothing shows it
  })
}

/**
 * Repeats the backend's rule (exports.py check_quality) so the sheet can show 1080p
 * only where it works; the backend still refuses it (422) for a smaller video.
 */
const MIN_1080P_SHORT_SIDE = 1080
export const can1080p = (video: Pick<VideoPublic, "width" | "height">) =>
  Math.min(video.width ?? 0, video.height ?? 0) >= MIN_1080P_SHORT_SIDE

/**
 * Save the file, from a blob URL. Not a link to the file itself: although it's an
 * attachment, WebKit (Playwright's, at least) navigates the whole page to a
 * cross-origin MP4 instead of saving it, which would close the editor. A blob URL is
 * same-origin, so `download` names it and the page stays.
 */
export function downloadExport(file: Blob, filename: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Long enough for the browser to start saving it
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Share the MP4 with the system share sheet (Messages, Instagram, Photos…) where the
 * browser can share files; otherwise download it. "shared" / "downloaded" /
 * "cancelled" (the user closed the share sheet).
 *
 * TODO(capacitor): in the iOS/Android app, share with the Capacitor Share plugin
 * (@capacitor/share, after writing the file with @capacitor/filesystem) instead of
 * the Web Share API, which WKWebView doesn't offer for files.
 */
export async function shareExport({
  getFile,
  filename,
  title,
}: {
  /** The file (cached once read: see exportFileQueryOptions). */
  getFile: () => Promise<Blob>
  filename: string
  title: string
}): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await getFile()
  const files = [new File([blob], filename, { type: "video/mp4" })]
  if (
    typeof navigator.canShare !== "function" ||
    !navigator.share ||
    !navigator.canShare({ files })
  ) {
    downloadExport(blob, filename)
    return "downloaded"
  }
  try {
    await navigator.share({ files, title })
    return "shared"
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return "cancelled"
    // NotAllowedError: the tap no longer counts (the file took too long); save it
    downloadExport(blob, filename)
    return "downloaded"
  }
}
