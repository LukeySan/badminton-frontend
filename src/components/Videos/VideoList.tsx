import { Link } from "@tanstack/react-router"
import { MapPin, RotateCw, Upload } from "lucide-react"

import type { VideoPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import useCustomToast from "@/hooks/useCustomToast"
import { formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import { CourtThumbnail } from "./CourtThumbnail"
import { VideoActionsMenu } from "./DeleteVideo"
import { failureInfo, useRetryVideo } from "./failure"
import { VideoStatusBadge } from "./VideoStatusBadge"

export type VideoFilter = "all" | "ready" | "todo"

const FILTERS: { value: VideoFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "todo", label: "To do" },
]

export function matchesFilter(video: VideoPublic, filter: VideoFilter) {
  if (filter === "ready") return video.status === "done"
  if (filter === "todo") return video.status !== "done"
  return true
}

/** All / Ready / To do pills. Selected = foreground fill (DESIGN.md). */
export function VideoFilterChips({
  value,
  onChange,
}: {
  value: VideoFilter
  onChange: (filter: VideoFilter) => void
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // Radix lets you un-press the selected item; a filter always has a value.
      onValueChange={(next) => next && onChange(next as VideoFilter)}
      aria-label="Filter videos"
    >
      {FILTERS.map((filter) => (
        <ToggleGroupItem
          key={filter.value}
          value={filter.value}
          className={cn(
            "relative h-[30px] min-w-0 rounded-full border px-3 text-xs font-semibold text-muted-foreground",
            "data-[state=off]:bg-card data-[state=off]:hover:bg-secondary data-[state=off]:hover:text-foreground dark:data-[state=off]:bg-transparent",
            "data-[state=on]:border-transparent data-[state=on]:bg-foreground data-[state=on]:font-extrabold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
            // 44 px tall touch target around the 30 px pill
            "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
          )}
        >
          {filter.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Light theme: each row is a white card; dark: flat rows (DESIGN.md "Video row"). */
export function VideoList({
  videos,
  filter,
}: {
  videos: VideoPublic[]
  filter: VideoFilter
}) {
  if (videos.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {filter === "ready"
          ? "No videos are ready yet. They show up here once analyzed."
          : "Nothing to do: every video is ready to watch."}
      </p>
    )
  }
  return (
    <ul className="-mx-1 flex flex-col gap-1.5 lg:grid lg:grid-cols-2 dark:-mx-2 dark:gap-0">
      {videos.map((video) => (
        <li key={video.id}>
          <VideoRow video={video} />
        </li>
      ))}
    </ul>
  )
}

function VideoRow({ video }: { video: VideoPublic }) {
  // The row opens the video's next step: court marking until the court is set.
  const to = video.status === "uploaded" ? "/videos/$id/court" : "/videos/$id"
  // "Stretched link": the title's link covers the whole row with its ::after, and
  // the buttons sit above it (relative z-10). Buttons can't go inside a link (invalid
  // HTML, and both would react to a tap), and the link's name stays just the title.
  return (
    <div
      className={cn(
        "relative grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-card p-2 pr-1 transition-colors",
        "hover:bg-secondary has-[a:focus-visible]:bg-secondary has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
        "dark:rounded-[14px] dark:bg-transparent dark:py-2.5 dark:hover:bg-card dark:has-[a:focus-visible]:bg-card",
      )}
    >
      <CourtThumbnail duration={video.duration} />
      <span className="flex min-w-0 flex-col gap-1">
        <Link
          to={to}
          params={{ id: video.id }}
          className="block truncate text-sm font-bold outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
        >
          {video.filename.replace(/\.[^.]+$/, "")}
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatShortDate(video.created_at)}
        </span>
        <VideoStatusBadge video={video} />
        {video.status === "failed" && <FailedRowAction video={video} />}
      </span>
      <VideoActionsMenu video={video} className="relative z-10" />
    </div>
  )
}

// Small button, 44 px tall touch target (::after), above the row's stretched link.
const rowAction =
  "relative z-10 mt-0.5 h-8 self-start px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"

/** Failed row: the one fix that can help (re-mark the court, or run it again). */
function FailedRowAction({ video }: { video: VideoPublic }) {
  const retry = useRetryVideo(video)
  const { showErrorToast } = useCustomToast()
  if (failureInfo(video).courtFirst) {
    return (
      <Button asChild size="sm" variant="outline" className={rowAction}>
        <Link to="/videos/$id/court" params={{ id: video.id }}>
          <MapPin />
          Re-mark court
        </Link>
      </Button>
    )
  }
  return (
    <LoadingButton
      size="sm"
      variant="outline"
      className={rowAction}
      loading={retry.isPending}
      onClick={() =>
        retry.mutate(undefined, {
          // e.g. 429: two videos are already in line
          onError: (error) => showErrorToast(extractErrorMessage(error)),
        })
      }
    >
      {!retry.isPending && <RotateCw />}
      Try again
    </LoadingButton>
  )
}

export function VideoListSkeleton() {
  return (
    <ul className="-mx-1 flex flex-col gap-1.5 dark:-mx-2" aria-busy="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <li
          key={index}
          className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 p-2"
        >
          <Skeleton className="h-[54px] w-24 rounded-[10px]" />
          <span className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[22px] w-28 rounded-full" />
          </span>
        </li>
      ))}
    </ul>
  )
}

export function NoVideosYet() {
  return (
    <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-12 text-center">
      <CourtThumbnail duration={null} />
      <div>
        <h2 className="text-[15px] font-extrabold">No matches yet</h2>
        <p className="text-sm text-muted-foreground">
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
