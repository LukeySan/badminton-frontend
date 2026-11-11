import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Stand-in for a video thumbnail: a court seen from behind the baseline (DESIGN.md
 * "Video row"), with a length in a chip. `md` 96×54 (video rows), `sm` 72×40
 * (rally rows in the highlight editor).
 */
export function CourtThumbnail({
  duration,
  size = "md",
}: {
  duration: number | null
  size?: "md" | "sm"
}) {
  const small = size === "sm"
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden bg-court",
        small ? "h-10 w-[72px] rounded-[8px]" : "h-[54px] w-24 rounded-[10px]",
      )}
    >
      {small ? (
        <svg
          width="72"
          height="40"
          viewBox="0 0 72 40"
          fill="none"
          strokeWidth={1}
          aria-hidden="true"
        >
          <path d="M24 9 L48 9 L68 37 L4 37 Z" className="stroke-court-line" />
          <path d="M18 20 L54 20" className="stroke-court-foreground" />
        </svg>
      ) : (
        <svg
          width="96"
          height="54"
          viewBox="0 0 96 54"
          fill="none"
          strokeWidth={1.2}
          aria-hidden="true"
        >
          <path
            d="M32 12 L64 12 L90 50 L6 50 Z"
            className="stroke-court-line"
          />
          <path d="M24 27 L72 27" className="stroke-court-foreground" />
        </svg>
      )}
      {duration != null && (
        <span
          className={cn(
            "absolute rounded-[4px] bg-court-ink/85 font-bold text-court-foreground tabular-nums",
            small
              ? "right-[3px] bottom-[3px] px-1 text-[10px]"
              : "right-1 bottom-1 px-[5px] py-px text-[10px]",
          )}
        >
          {formatDuration(duration)}
        </span>
      )}
    </span>
  )
}
