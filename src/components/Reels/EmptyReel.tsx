import {
  ChevronRight,
  Clapperboard,
  ListChecks,
  Rows3,
  Trophy,
} from "lucide-react"
import type { ReactNode } from "react"

import { QUICK_PICKS } from "./reelEdit"

/**
 * Edit mode with nothing picked: what a reel is, and three ways to start one. Picking
 * (here or in Highlights) is what creates the reel; just watching never does.
 */
export function EmptyReel({
  rallyCount,
  onLongest,
  onAll,
  onPickFromList,
}: {
  rallyCount: number
  onLongest: () => void
  onAll: () => void
  onPickFromList: () => void
}) {
  const none = rallyCount === 0
  return (
    <section
      aria-labelledby="empty-reel-title"
      className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-4 pb-[max(1.375rem,env(safe-area-inset-bottom))] text-center md:px-0"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-card text-court-accent">
        <Clapperboard className="size-6" />
      </span>
      <h2 id="empty-reel-title" className="mt-3 text-[15px] font-extrabold">
        Your reel is empty
      </h2>
      <p className="mt-1 max-w-72 text-[13px] text-muted-foreground">
        {none
          ? "No rallies were found in this match."
          : "Start with some rallies, then cut, slow down and caption them here."}
      </p>
      <div className="mt-4 flex w-full max-w-sm flex-col gap-2 text-left">
        <QuickStart
          icon={<Trophy />}
          title={`Longest ${QUICK_PICKS}`}
          detail="The best rallies are usually the longest"
          disabled={none}
          onClick={onLongest}
        />
        <QuickStart
          icon={<Rows3 />}
          title="All rallies"
          detail={`Every rally of the match (${rallyCount}), no breaks`}
          disabled={none}
          onClick={onAll}
        />
        <QuickStart
          icon={<ListChecks />}
          title="Pick from the list"
          detail="Choose rallies one by one in Highlights"
          disabled={none}
          onClick={onPickFromList}
        />
      </div>
    </section>
  )
}

function QuickStart({
  icon,
  title,
  detail,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  detail: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 items-center gap-3 rounded-[14px] bg-card px-3 py-2 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-success-soft text-success-text">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-extrabold">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="shrink-0 text-muted-foreground" />
    </button>
  )
}
