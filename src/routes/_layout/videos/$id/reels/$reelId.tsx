import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"

import { reelQueryOptions } from "@/components/Reels/queries"
import { type EditorMode, ReelEditor } from "@/components/Reels/ReelEditor"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { videoQueryOptions } from "@/components/Videos/queries"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/videos/$id/reels/$reelId")({
  component: ReelPage,
  // The mode is in the URL (?mode=edit): a reload or a shared link keeps it.
  validateSearch: (search: Record<string, unknown>): { mode?: "edit" } =>
    search.mode === "edit" ? { mode: "edit" } : {},
  head: () => ({ meta: [{ title: "Highlight - Rally Analyzer" }] }),
})

function ReelPage() {
  const { id, reelId } = Route.useParams()
  const { mode = "highlights" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const video = useQuery(videoQueryOptions(id))
  const reel = useQuery(reelQueryOptions(id, reelId))

  const setMode = (next: EditorMode) =>
    navigate({
      search: next === "edit" ? { mode: "edit" } : {},
      replace: true,
      resetScroll: false,
    })

  if (video.isError || reel.isError) {
    const error = (video.error ?? reel.error)!
    return (
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertTitle>Couldn't open this highlight</AlertTitle>
        <AlertDescription>
          <p>{extractErrorMessage(error)}</p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link to="/videos/$id" params={{ id }}>
              Back to the match
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!video.data || !reel.data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (video.data.status !== "done") {
    // Re-analysis replaces the rallies; edit again once it's done.
    return (
      <Alert className="mx-auto max-w-2xl">
        <AlertTitle>This match is being analyzed again</AlertTitle>
        <AlertDescription>
          <p>You can edit the highlight once it's done.</p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link to="/videos/$id" params={{ id }}>
              See progress
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ReelEditor
        key={reel.data.id}
        video={video.data}
        reel={reel.data}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  )
}
