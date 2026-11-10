import { ChevronRight } from "lucide-react"

import type { VideoPublic } from "@/client"
import { cn } from "@/lib/utils"

const pill =
  "inline-flex h-[22px] shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-full px-2 text-[11px] font-extrabold"

/**
 * Status pill (DESIGN.md "Status badge"). Green = ready, pink = needs fixing,
 * outline = your next step, a thin bar while the worker runs.
 */
export function VideoStatusBadge({
  video,
}: {
  video: Pick<VideoPublic, "status" | "progress" | "rally_count">
}) {
  switch (video.status) {
    case "done":
      return (
        <span
          data-testid="video-status"
          className={cn(pill, "bg-success-soft text-success-text")}
        >
          Ready · {video.rally_count}{" "}
          {video.rally_count === 1 ? "rally" : "rallies"}
        </span>
      )
    case "queued":
    case "processing": {
      const percent = Math.round(video.progress * 100)
      return (
        <span
          data-testid="video-status"
          className="flex min-w-0 items-center gap-2"
        >
          <span className="whitespace-nowrap text-[11px] font-extrabold tabular-nums">
            {video.status === "queued" ? "Queued" : `Analyzing ${percent}%`}
          </span>
          <span className="relative h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-track">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-chapter"
              style={{ width: `${video.status === "queued" ? 0 : percent}%` }}
            />
          </span>
        </span>
      )
    }
    case "uploaded":
      return (
        <span
          data-testid="video-status"
          className={cn(pill, "border border-muted-foreground text-foreground")}
        >
          Mark the court
          <ChevronRight className="size-3" strokeWidth={2.5} />
        </span>
      )
    case "failed":
      return (
        <span
          data-testid="video-status"
          className={cn(pill, "bg-highlight/16 text-highlight-text-strong")}
        >
          Failed · Try again
        </span>
      )
  }
}
