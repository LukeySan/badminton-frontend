import { queryOptions } from "@tanstack/react-query"

import { type VideoPublic, VideosService } from "@/client"
import { parseApiDate } from "@/lib/format"

export type VideoStatus = VideoPublic["status"]

/** How often to ask the API for news while the worker is busy with a video. */
export const POLL_INTERVAL_MS = 3000

/** The worker still has work to do: keep polling until the status changes. */
export function isInProgress(status: VideoStatus | undefined): boolean {
  return status === "queued" || status === "processing"
}

// Query keys follow CLAUDE.md: ["videos"], ["videos", id], ["videos", id, "rallies"].
// Because keys are prefixes of each other, invalidating ["videos"] refreshes all of
// them; pass `exact: true` to refresh only the list.

export function videosQueryOptions() {
  return queryOptions({
    queryKey: ["videos"],
    queryFn: async () =>
      (await VideosService.readVideos({ query: { skip: 0, limit: 100 } })).data,
    // Poll only while some video is being worked on, so idle lists cost nothing.
    refetchInterval: (query) =>
      query.state.data?.data.some((video) => isInProgress(video.status))
        ? POLL_INTERVAL_MS
        : false,
  })
}

export function videoQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["videos", id],
    queryFn: async () => (await VideosService.readVideo({ path: { id } })).data,
    // Stops by itself once the video is done or failed.
    refetchInterval: (query) =>
      isInProgress(query.state.data?.status) ? POLL_INTERVAL_MS : false,
  })
}

/** One frame (JPEG) at `t` seconds, for marking the court. */
export function frameQueryOptions(id: string, t: number) {
  return queryOptions({
    queryKey: ["videos", id, "frame", t],
    queryFn: async () => {
      // Needs the login header, so it's fetched through the client (not <img src>).
      const { data } = await VideosService.readVideoFrame({
        path: { id },
        query: { t },
      })
      // The spec only says "image/jpeg", so the generated type is `unknown`.
      if (!(data instanceof Blob)) throw new Error("Expected an image")
      return data
    },
    staleTime: Number.POSITIVE_INFINITY, // a frame of the same video never changes
  })
}

/** Get a new link this long before the old one expires. */
const FILE_URL_RENEW_MS = 5 * 60_000

/** Signed, expiring link for <video src> (the video tag can't send the login header). */
export function fileUrlQueryOptions(id: string) {
  const msUntilRenewal = (expiresAt: string | undefined) =>
    expiresAt
      ? Math.max(
          0,
          parseApiDate(expiresAt).getTime() - Date.now() - FILE_URL_RENEW_MS,
        )
      : 0
  return queryOptions({
    queryKey: ["videos", id, "file-url"],
    queryFn: async () =>
      (await VideosService.readVideoFileUrl({ path: { id } })).data,
    // Every fetch returns a *new* URL, and a new URL reloads the video. So the link
    // counts as fresh until shortly before it expires (no refetch on window focus
    // or remount), and is renewed once at that point.
    staleTime: (query) => msUntilRenewal(query.state.data?.expires_at),
    refetchInterval: (query) =>
      query.state.data
        ? Math.max(10_000, msUntilRenewal(query.state.data.expires_at))
        : false,
  })
}

export function ralliesQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["videos", id, "rallies"],
    queryFn: async () =>
      (await VideosService.readVideoRallies({ path: { id } })).data,
  })
}
