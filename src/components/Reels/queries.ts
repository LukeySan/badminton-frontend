import { queryOptions } from "@tanstack/react-query"
import { AxiosError } from "axios"

import { ReelsService } from "@/client"

// One reel per video (GET/PUT /videos/{id}/reel). Its key sits under its video
// (["videos", id, "reel"]), so deleting the video (which removes ["videos", id] by
// prefix) drops it from the cache.

export const isReelMissing = (error: unknown) =>
  error instanceof AxiosError &&
  error.response?.status === 404 &&
  error.response.data?.code === "reel_missing"

/** The video's reel, or null when it has none yet (it's made on the first change). */
export function videoReelQueryOptions(videoId: string) {
  return queryOptions({
    queryKey: ["videos", videoId, "reel"],
    queryFn: async () => {
      try {
        return (await ReelsService.readVideoReel({ path: { id: videoId } }))
          .data
      } catch (error) {
        if (isReelMissing(error)) return null
        throw error
      }
    },
    // The editor owns the edit list once loaded (autosave writes it back). A
    // background refetch must not replace it under the user's fingers: the reel is
    // only read again on purpose, after a conflict or a rally fix.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
}
