import { useQueries, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { useMemo } from "react"

import { PhoneHeader } from "@/components/Common/PhoneHeader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { LastMatchCard } from "@/components/Videos/LastMatchCard"
import {
  ralliesQueryOptions,
  videosQueryOptions,
} from "@/components/Videos/queries"
import {
  matchesFilter,
  NoVideosYet,
  type VideoFilter,
  VideoFilterChips,
  VideoList,
  VideoListSkeleton,
} from "@/components/Videos/VideoList"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/")({
  component: Home,
  // The filter lives in the URL (?filter=ready), so it survives going into a video
  // and back, and a filtered list can be linked.
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: "ready" | "todo" } =>
    search.filter === "ready" || search.filter === "todo"
      ? { filter: search.filter }
      : {},
  head: () => ({
    meta: [
      {
        title: "Your matches - Rally Analyzer",
      },
    ],
  }),
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function Home() {
  const { filter = "all" } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const videosQuery = useQuery(videosQueryOptions())
  const videos = videosQuery.data?.data ?? []

  // Newest first (API order), so the first done video is the latest match.
  const done = useMemo(
    () => videos.filter((v) => v.status === "done"),
    [videos],
  )
  // Rally counts for the "Ready · 73 rallies" badges. One request per analyzed
  // video, shared with the player through the cache.
  // TODO(backend): a rally_count / play_time field on VideoPublic would avoid these.
  const rallyResults = useQueries({
    queries: done.map((video) => ralliesQueryOptions(video.id)),
  })
  const rallyCounts = Object.fromEntries(
    done.map((video, i) => [video.id, rallyResults[i]?.data?.count]),
  )

  const setFilter = (next: VideoFilter) =>
    navigate({ search: next === "all" ? {} : { filter: next }, replace: true })

  return (
    <div className="flex flex-col">
      <PhoneHeader />

      <div className="flex items-end justify-between gap-4 pt-2.5 md:pt-0">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">
            Your matches
          </h1>
          {videosQuery.isSuccess ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {plural(videosQuery.data.count, "video")} · {done.length} ready to
              watch
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-40" />
          )}
        </div>
        {/* Phones upload from the tab bar */}
        <Button asChild className="hidden md:inline-flex">
          <Link to="/upload">
            <Upload />
            Upload video
          </Link>
        </Button>
      </div>

      {videosQuery.isPending ? (
        <div className="mt-4 flex flex-col gap-5">
          <Skeleton className="h-[104px] w-full rounded-xl" />
          <VideoListSkeleton />
        </div>
      ) : videosQuery.isError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Couldn't load your videos</AlertTitle>
          <AlertDescription>
            <p>{extractErrorMessage(videosQuery.error)}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => videosQuery.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : videos.length === 0 ? (
        <NoVideosYet />
      ) : (
        <>
          {done[0] && <LastMatchCard video={done[0]} className="mt-4" />}

          <section aria-labelledby="recent-heading" className="mt-5">
            <div className="flex items-center justify-between gap-3 pb-2">
              <h2 id="recent-heading" className="text-[15px] font-extrabold">
                Recent
              </h2>
              <VideoFilterChips value={filter} onChange={setFilter} />
            </div>
            <VideoList
              videos={videos.filter((video) => matchesFilter(video, filter))}
              rallyCounts={rallyCounts}
              filter={filter}
            />
            {videosQuery.data.count > videos.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the newest {videos.length} of {videosQuery.data.count}{" "}
                videos.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
