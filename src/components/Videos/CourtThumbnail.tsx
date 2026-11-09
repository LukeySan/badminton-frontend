import { formatDuration } from "@/lib/format"

/**
 * 96×54 stand-in for a video thumbnail: a court seen from behind the baseline
 * (DESIGN.md "Video row"), with the video's length in a chip.
 */
export function CourtThumbnail({ duration }: { duration: number | null }) {
  return (
    <span className="relative block h-[54px] w-24 shrink-0 overflow-hidden rounded-[10px] bg-court">
      <svg
        width="96"
        height="54"
        viewBox="0 0 96 54"
        fill="none"
        strokeWidth={1.2}
        aria-hidden="true"
      >
        <path d="M32 12 L64 12 L90 50 L6 50 Z" className="stroke-court-line" />
        <path d="M24 27 L72 27" className="stroke-court-foreground" />
      </svg>
      {duration != null && (
        <span className="absolute right-1 bottom-1 rounded-[4px] bg-court-ink/85 px-[5px] py-px text-[10px] font-bold text-court-foreground tabular-nums">
          {formatDuration(duration)}
        </span>
      )}
    </span>
  )
}
