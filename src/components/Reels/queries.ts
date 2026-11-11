import { queryOptions } from "@tanstack/react-query"

import { ReelsService } from "@/client"

// A reel's key sits under its video (["videos", id, "reels", reelId]), so deleting
// the video (which removes ["videos", id] by prefix) drops its reels from the cache.

export function reelQueryOptions(videoId: string, reelId: string) {
  return queryOptions({
    queryKey: ["videos", videoId, "reels", reelId],
    queryFn: async () =>
      (await ReelsService.readReel({ path: { reel_id: reelId } })).data,
    // The editor owns the edit list once loaded (autosave writes it back). A
    // background refetch must not replace it under the user's fingers: the reel is
    // only read again on purpose, after a conflict.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
}
