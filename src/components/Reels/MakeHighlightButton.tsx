import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Clapperboard } from "lucide-react"

import { ReelsService, type VideoPublic } from "@/client"
import { LoadingButton } from "@/components/ui/loading-button"
import { ralliesQueryOptions } from "@/components/Videos/queries"
import useCustomToast from "@/hooks/useCustomToast"
import { extractErrorMessage } from "@/utils"
import { reelQueryOptions } from "./queries"
import { starterEdit } from "./reelEdit"

/**
 * Player header: makes a new reel with the longest few rallies already picked and
 * opens it in the editor.
 */
export function MakeHighlightButton({ video }: { video: VideoPublic }) {
  const rallies = useQuery(ralliesQueryOptions(video.id))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showErrorToast } = useCustomToast()

  const create = useMutation({
    mutationFn: async () => {
      const name = video.filename.replace(/\.[^.]+$/, "")
      const { data } = await ReelsService.createReel({
        path: { id: video.id },
        body: {
          title: `${name} highlights`,
          edit: starterEdit(rallies.data?.data ?? [], video.duration ?? 0),
        },
      })
      return data
    },
    onSuccess: (reel) => {
      // The editor opens with what we just got back, no second request.
      queryClient.setQueryData(
        reelQueryOptions(video.id, reel.id).queryKey,
        reel,
      )
      navigate({
        to: "/videos/$id/reels/$reelId",
        params: { id: video.id, reelId: reel.id },
      })
    },
    onError: (error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <LoadingButton
      size="sm"
      // 44 px tall touch target around the 32 px button
      className="relative shrink-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
      loading={create.isPending}
      disabled={!rallies.isSuccess}
      onClick={() => create.mutate()}
      aria-label="Make a highlight"
    >
      {!create.isPending && <Clapperboard />}
      <span className="sm:hidden">Highlight</span>
      <span className="max-sm:hidden">Make a highlight</span>
    </LoadingButton>
  )
}
