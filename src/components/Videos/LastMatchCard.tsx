import { Link } from "@tanstack/react-router"
import { Play } from "lucide-react"

import type { VideoPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Featured card for the most recent analyzed video: how much actual play it had
 * (`play_seconds`, the sum of the rally lengths) versus how long the recording is.
 */
export function LastMatchCard({
  video,
  className,
}: {
  video: VideoPublic
  className?: string
}) {
  return (
    <section
      aria-label="Last match"
      className={cn(
        "flex items-center gap-3 rounded-xl bg-court p-3.5 text-court-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-bold text-court-accent">Last match</span>
        <span className="text-[22px] font-extrabold leading-[1.15] tabular-nums">
          {formatDuration(video.play_seconds)} of play
        </span>
        <span className="text-sm font-semibold text-court-muted tabular-nums">
          out of {formatDuration(video.duration)} recorded
        </span>
      </div>
      <Button
        asChild
        className="h-10 shrink-0 gap-1.5 rounded-md bg-court-foreground px-3.5 text-[13px] font-extrabold text-court-ink hover:bg-court-foreground/90"
      >
        <Link
          to="/videos/$id"
          params={{ id: video.id }}
          aria-label={`Watch ${video.filename}`}
        >
          <Play className="size-3.5" fill="currentColor" strokeWidth={0} />
          Watch
        </Link>
      </Button>
    </section>
  )
}
