import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CourtEditor } from "@/components/Videos/CourtEditor"
import { isInProgress, videoQueryOptions } from "@/components/Videos/queries"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/videos/$id/court")({
  component: MarkCourt,
  head: () => ({
    meta: [
      {
        title: "Mark court - Rally Analyzer",
      },
    ],
  }),
})

function MarkCourt() {
  const { id } = Route.useParams()
  const {
    data: video,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(videoQueryOptions(id))

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
        <Link to="/">
          <ChevronLeft />
          All videos
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mark the court</h1>
        {video && (
          <p className="wrap-break-word text-muted-foreground">
            {video.filename}
          </p>
        )}
      </div>

      {isPending ? (
        <Skeleton className="aspect-video w-full" />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load this video</AlertTitle>
          <AlertDescription>
            <p>{extractErrorMessage(error)}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : isInProgress(video.status) ? (
        // The backend refuses court changes while a job runs (409); say so up front.
        <Card>
          <CardHeader>
            <CardTitle>This video is being analyzed</CardTitle>
            <CardDescription>
              You can change the court after the analysis has finished.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/videos/$id" params={{ id }}>
                See progress
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <CourtEditor key={video.id} video={video} />
      )}
    </div>
  )
}
