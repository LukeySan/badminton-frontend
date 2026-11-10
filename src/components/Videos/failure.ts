import { useMutation, useQueryClient } from "@tanstack/react-query"

import { type FailureReason, type VideoPublic, VideosService } from "@/client"
import {
  invalidateVideoLists,
  ralliesQueryOptions,
  videoQueryOptions,
} from "./queries"

// The backend says *why* a job failed (`failure_reason`, an enum); the app says what
// to do about it. A Record over the generated type: if the backend adds a reason,
// TypeScript points here.

type FailureInfo = {
  /** Fits the status pill on a video row. */
  short: string
  /** What happened and what to do, for the video page. */
  help: string
  /** Running it again with the same court can't help: re-mark the court first. */
  courtFirst: boolean
}

const FAILURES: Record<FailureReason, FailureInfo> = {
  "Couldn't read this video": {
    short: "Can't read video",
    help: "The file may be damaged or in a format we can't decode. Try again, or export it again from your phone's gallery and upload that copy.",
    courtFirst: false,
  },
  "Court not visible": {
    short: "Court not visible",
    help: "We hardly ever saw the shuttle inside the court you marked. Check that the four corners sit on the outer court lines, and that the whole court is in the picture.",
    courtFirst: true,
  },
  "Processing kept stopping on this video": {
    short: "Kept stopping",
    help: "The analysis stopped several times on this video. Try again; if it fails again, please send us feedback from your Profile.",
    courtFirst: false,
  },
  "Something went wrong while processing this video": {
    short: "Something went wrong",
    help: "This was a problem on our side, not with your video. Try again; if it keeps failing, please send us feedback from your Profile.",
    courtFirst: false,
  },
}

const UNKNOWN: FailureReason =
  "Something went wrong while processing this video"

/** Reason + advice for a failed video (older failures have no reason). */
export function failureInfo(video: Pick<VideoPublic, "failure_reason">) {
  const reason = video.failure_reason ?? UNKNOWN
  return { reason, ...FAILURES[reason] }
}

/**
 * Queue a failed (or finished) video again. The backend may refuse: 409 (already
 * queued, no court) or 429 (two videos already in line); callers show its message.
 */
export function useRetryVideo(video: VideoPublic) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      (await VideosService.processVideo({ path: { id: video.id } })).data,
    onSuccess: (updated) => {
      // The response is the queued video: the page switches to the progress view
      // (and starts polling) without waiting for a refetch.
      queryClient.setQueryData(videoQueryOptions(video.id).queryKey, updated)
      queryClient.removeQueries({
        queryKey: ralliesQueryOptions(video.id).queryKey,
      })
      invalidateVideoLists(queryClient)
    },
  })
}
