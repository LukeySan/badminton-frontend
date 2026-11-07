import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeft, CircleCheck, MapPin, RotateCw } from "lucide-react"

import type { VideoPublic } from "@/client"
import { VideosService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ralliesQueryOptions,
  videoQueryOptions,
  videosQueryOptions,
} from "@/components/Videos/queries"
import { VideoStatusBadge } from "@/components/Videos/VideoStatusBadge"
import { formatDate, formatDuration, formatMinutes } from "@/lib/format"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/videos/$id/")({
  component: VideoPage,
  head: () => ({
    meta: [
      {
        title: "Video - Rally Analyzer",
      },
    ],
  }),
})

// Processing takes roughly half the video's length in fast mode (backend benchmark).
const PROCESSING_TIME_PER_VIDEO_SECOND = 0.5

// One URL per video; what it shows follows the status the API reports. Polling (set
// in videoQueryOptions) runs only while queued/processing, so this page switches from
// the progress view to the result by itself.
function VideoPage() {
  const { id } = Route.useParams()
  const {
    data: video,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(videoQueryOptions(id))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
        <Link to="/">
          <ChevronLeft />
          All videos
        </Link>
      </Button>

      {isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
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
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 wrap-break-word text-2xl font-bold tracking-tight">
                {video.filename}
              </h1>
              <div className="pt-1.5">
                <VideoStatusBadge video={video} />
              </div>
            </div>
            <p className="text-muted-foreground">
              {formatDuration(video.duration)} · uploaded{" "}
              {formatDate(video.created_at)}
            </p>
          </div>
          <VideoStatusView video={video} />
        </>
      )}
    </div>
  )
}

function VideoStatusView({ video }: { video: VideoPublic }) {
  switch (video.status) {
    case "uploaded":
      return <NeedsCourt video={video} />
    case "queued":
    case "processing":
      return <Processing video={video} />
    case "failed":
      return <Failed video={video} />
    case "done":
      return <Done video={video} />
  }
}

function NeedsCourt({ video }: { video: VideoPublic }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mark the court</CardTitle>
        <CardDescription>
          Tap the four corners of your court so we know where to look for the
          shuttle.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild className="w-full sm:w-auto">
          <Link to="/videos/$id/court" params={{ id: video.id }}>
            <MapPin />
            Mark court
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function Processing({ video }: { video: VideoPublic }) {
  const queued = video.status === "queued"
  const percent = Math.round(video.progress * 100)
  const estimate =
    video.duration != null
      ? video.duration * PROCESSING_TIME_PER_VIDEO_SECOND * (1 - video.progress)
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {queued ? "Waiting to start" : "Finding rallies…"}
        </CardTitle>
        <CardDescription>
          You can leave this page. Processing continues on the server and the
          video shows up as Ready in your list when it's done.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Progress value={percent} aria-label="Processing progress" />
        {/* aria-live: screen readers announce the updates the polling brings in */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {queued
            ? "In line: starts as soon as a worker is free."
            : `${percent}% done`}
          {estimate != null &&
            ` · ${formatMinutes(estimate)} ${queued ? "once started" : "left"}`}
        </p>
      </CardContent>
    </Card>
  )
}

function Failed({ video }: { video: VideoPublic }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    mutationFn: async () =>
      (await VideosService.processVideo({ path: { id: video.id } })).data,
    onSuccess: (updated) => {
      // The response is the queued video: put it in the cache so the page switches
      // to the progress view (and starts polling) without waiting for a refetch.
      queryClient.setQueryData(videoQueryOptions(video.id).queryKey, updated)
      queryClient.invalidateQueries({
        queryKey: videosQueryOptions().queryKey,
        exact: true,
      })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis failed</CardTitle>
        <CardDescription>
          Try again, or re-mark the court if the corners might be off.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {video.error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="max-h-40 overflow-y-auto wrap-break-word">
              {video.error}
            </AlertDescription>
          </Alert>
        )}
        {retry.isError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't restart</AlertTitle>
            <AlertDescription>
              {extractErrorMessage(retry.error)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link to="/videos/$id/court" params={{ id: video.id }}>
            <MapPin />
            Re-mark court
          </Link>
        </Button>
        <LoadingButton
          className="w-full sm:w-auto"
          loading={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {!retry.isPending && <RotateCw />}
          Try again
        </LoadingButton>
      </CardFooter>
    </Card>
  )
}

// Placeholder until the player (M5): confirms the result end to end.
function Done({ video }: { video: VideoPublic }) {
  const rallies = useQuery(ralliesQueryOptions(video.id))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheck className="size-5 text-primary" />
          Rallies ready
        </CardTitle>
        <CardDescription>
          {rallies.isSuccess
            ? `${rallies.data.count} rallies found.`
            : rallies.isError
              ? extractErrorMessage(rallies.error)
              : "Loading rallies…"}{" "}
          The player with chapters comes next.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
