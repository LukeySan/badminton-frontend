import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, Film, Upload } from "lucide-react"

import type { VideoPublic } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, formatDuration } from "@/lib/format"
import { extractErrorMessage } from "@/utils"
import { isInProgress, videosQueryOptions } from "./queries"
import { VideoStatusBadge } from "./VideoStatusBadge"

// A stacked list instead of the template's DataTable: a 5-column table doesn't fit a
// phone screen, while a row with a truncating filename and a badge works at any width.

export function VideoList() {
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery(
    videosQueryOptions(),
  )

  if (isPending) return <VideoListSkeleton />

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load your videos</AlertTitle>
        <AlertDescription>
          <p>{extractErrorMessage(error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (data.data.length === 0) return <EmptyState />

  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y overflow-hidden rounded-lg border">
        {data.data.map((video) => (
          <li key={video.id}>
            <VideoRow video={video} />
          </li>
        ))}
      </ul>
      {data.count > data.data.length && (
        <p className="text-sm text-muted-foreground">
          Showing the newest {data.data.length} of {data.count} videos.
        </p>
      )}
    </div>
  )
}

function VideoRow({ video }: { video: VideoPublic }) {
  // Open the screen for the video's next step: a video without a court goes straight
  // to court marking; everything else to its status/player page.
  const to = video.status === "uploaded" ? "/videos/$id/court" : "/videos/$id"

  return (
    <Link
      to={to}
      params={{ id: video.id }}
      className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <div className="hidden size-10 shrink-0 items-center justify-center rounded-md bg-muted sm:flex">
        <Film className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{video.filename}</p>
        <p className="text-sm text-muted-foreground">
          {formatDate(video.created_at)} · {formatDuration(video.duration)}
        </p>
        {isInProgress(video.status) && (
          <Progress
            value={video.progress * 100}
            className="mt-2 h-1.5"
            aria-label={`${video.filename} progress`}
          />
        )}
      </div>
      <VideoStatusBadge video={video} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Film className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">No videos yet</h2>
        <p className="text-muted-foreground">
          Upload a match and we'll find every rally for you.
        </p>
      </div>
      <Button asChild>
        <Link to="/upload">
          <Upload />
          Upload a video
        </Link>
      </Button>
    </div>
  )
}

function VideoListSkeleton() {
  return (
    <ul className="divide-y rounded-lg border" aria-busy="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 p-4">
          <Skeleton className="hidden size-10 rounded-md sm:block" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  )
}
