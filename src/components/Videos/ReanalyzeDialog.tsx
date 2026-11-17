import { Sparkles } from "lucide-react"

import type { VideoPublic } from "@/client"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { extractErrorMessage } from "@/utils"
import { useRetryVideo } from "./failure"

/**
 * "Re-analyze with the latest detector?" for a video whose rallies were made by an
 * older detector (the backend says so: `detector_outdated`). Re-analyzing replaces
 * the rallies, so the user's rally fixes go; the server re-points the reel's clips.
 * On success the video is queued and its page shows the progress view by itself.
 */
export function ReanalyzeDialog({
  video,
  open,
  onOpenChange,
  beforeReanalyze,
}: {
  video: VideoPublic
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Save what's pending first (the reel), so the server re-points the latest. */
  beforeReanalyze: () => Promise<void>
}) {
  const reanalyze = useRetryVideo(video)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (reanalyze.isPending) return
        if (next) reanalyze.reset() // an old error doesn't apply to a new attempt
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-analyze with the latest detector?</DialogTitle>
          <DialogDescription>
            The new detector finds rallies more accurately and marks the ones it
            isn't sure about for you to check. It replaces this match's rallies,
            so fixes you made to them are lost. Your reel keeps the clips it can
            match to the new rallies.
          </DialogDescription>
        </DialogHeader>

        {reanalyze.isError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't start it</AlertTitle>
            <AlertDescription>
              {extractErrorMessage(reanalyze.error)}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="lg" disabled={reanalyze.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            size="lg"
            loading={reanalyze.isPending}
            onClick={async () => {
              await beforeReanalyze().catch(() => undefined)
              reanalyze.mutate()
            }}
          >
            {!reanalyze.isPending && <Sparkles />}
            Re-analyze
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
