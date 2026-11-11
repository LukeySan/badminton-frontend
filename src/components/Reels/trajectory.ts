import { queryOptions, useQueries } from "@tanstack/react-query"
import { AxiosError } from "axios"

import { type TrajectoryPoint, VideosService } from "@/client"

// The shuttle's position per frame, from GET /videos/{id}/trajectory (at most 600 s
// per request). Loaded in chunks around the playhead and kept: a match is ~50 KB
// gzipped on the server, a 60 s chunk ~100 KB of JSON here.

/** Seconds per request. */
export const CHUNK_SECONDS = 60
/** How much of the past the trail shows. */
export const TRAIL_SECONDS = 0.6

export const isTrajectoryMissing = (error: unknown) =>
  error instanceof AxiosError &&
  error.response?.status === 404 &&
  error.response.data?.code === "trajectory_missing"

export function trajectoryChunkQueryOptions(videoId: string, chunk: number) {
  return queryOptions({
    queryKey: ["videos", videoId, "trajectory", chunk],
    queryFn: async () =>
      (
        await VideosService.readVideoTrajectory({
          path: { id: videoId },
          query: {
            start: chunk * CHUNK_SECONDS,
            end: (chunk + 1) * CHUNK_SECONDS,
          },
        })
      ).data,
    // A trajectory only changes when the match is analyzed again.
    staleTime: Number.POSITIVE_INFINITY,
    // "Missing" is an answer, not a hiccup: don't retry it.
    retry: (count, error) => !isTrajectoryMissing(error) && count < 2,
  })
}

/**
 * The points needed around `time`: its chunk, the one before when the trail reaches
 * back into it, and the next one (prefetched, so crossing a chunk doesn't flicker).
 */
export function useTrajectory(videoId: string, time: number, enabled: boolean) {
  const current = Math.floor(Math.max(0, time) / CHUNK_SECONDS)
  const tail = Math.floor(Math.max(0, time - TRAIL_SECONDS) / CHUNK_SECONDS)
  const chunks = [...new Set([tail, current, current + 1])]
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      ...trajectoryChunkQueryOptions(videoId, chunk),
      enabled,
    })),
  })
  const missing = results.some((r) => isTrajectoryMissing(r.error))
  const points: TrajectoryPoint[] = results.flatMap((r) => r.data?.points ?? [])
  points.sort((a, b) => a.frame - b.frame)
  return { points, missing, fps: results.find((r) => r.data)?.data?.fps }
}
