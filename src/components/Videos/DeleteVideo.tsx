import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { EllipsisVertical, Trash2 } from "lucide-react"
import { useState } from "react"

import { type VideoPublic, VideosService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import {
  invalidateVideoLists,
  removeFromVideoLists,
  videoQueryOptions,
} from "./queries"

const displayName = (video: VideoPublic) =>
  video.filename.replace(/\.[^.]+$/, "")

/**
 * "Delete this video?" confirmation. Opened from a menu, so it's controlled by the
 * caller. If you're on the video's own page, it takes you Home after deleting.
 * The backend decides whether deleting is allowed (409 while processing) and its
 * message is shown in the dialog.
 */
export function DeleteVideoDialog({
  video,
  open,
  onOpenChange,
}: {
  video: VideoPublic
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast } = useCustomToast()
  // Params of every matched route: /videos/$id (player, processing) and its /court.
  const { id: pageVideoId } = useParams({ strict: false })
  const name = displayName(video)

  const remove = useMutation({
    mutationFn: async () =>
      (await VideosService.deleteVideo({ path: { id: video.id } })).data,
    onSuccess: async () => {
      onOpenChange(false)
      // Lists first, so Home never shows the deleted row.
      removeFromVideoLists(queryClient, video.id)
      if (pageVideoId === video.id) await navigate({ to: "/" })
      // Only after leaving its page: the page's own queries would refetch it (404).
      // Prefix match: also drops its rallies, frames and signed file link.
      queryClient.removeQueries({
        queryKey: videoQueryOptions(video.id).queryKey,
      })
      invalidateVideoLists(queryClient)
      showSuccessToast(`${name} was deleted`)
    },
    onError: () => {
      // Usually a 409: it started processing. Show the fresh status behind the dialog.
      queryClient.invalidateQueries({
        queryKey: videoQueryOptions(video.id).queryKey,
        exact: true,
      })
      invalidateVideoLists(queryClient)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (remove.isPending) return
        if (next) remove.reset() // an old error doesn't apply to a new attempt
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this video?</DialogTitle>
          <DialogDescription>
            <span className="font-bold text-foreground">{name}</span>
            {video.rally_count > 0 &&
              ` and its ${video.rally_count} ${video.rally_count === 1 ? "rally" : "rallies"}`}{" "}
            will be deleted for good. This can't be undone.
          </DialogDescription>
        </DialogHeader>

        {remove.isError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't delete it</AlertTitle>
            <AlertDescription>
              {extractErrorMessage(remove.error)}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="lg" disabled={remove.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            size="lg"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {!remove.isPending && <Trash2 />}
            Delete video
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** ⋮ menu on a video row (a sibling of the row's link, not inside it). */
export function VideoActionsMenu({
  video,
  className,
}: {
  video: VideoPublic
  className?: string
}) {
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-11 rounded-md text-muted-foreground",
              className,
            )}
            aria-label={`More options for ${displayName(video)}`}
          >
            <EllipsisVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleting(true)}
          >
            <Trash2 />
            Delete video
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteVideoDialog
        video={video}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </>
  )
}
