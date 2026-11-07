import { queryOptions } from "@tanstack/react-query"

import { type VideoPublic, VideosService } from "@/client"

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

export function ralliesQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["videos", id, "rallies"],
    queryFn: async () =>
      (await VideosService.readVideoRallies({ path: { id } })).data,
  })
}
