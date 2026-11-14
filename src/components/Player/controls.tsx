import { Check } from "lucide-react"
import type { ReactNode, Ref } from "react"

import {
  NextRallyIcon,
  PauseIcon,
  PlayIcon,
  PreviousRallyIcon,
} from "@/components/Common/AppIcons"
import { Button } from "@/components/ui/button"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

// Player controls shared by the player and the highlight editor (and their
// full-screen layers): one component per control, the same look everywhere.

/** Plain icon button in a 44×44 target, no background (DESIGN.md control row). */
export function ControlButton({
  ref,
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  ref?: Ref<HTMLButtonElement>
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className="size-11 rounded-xl text-foreground hover:bg-secondary/60"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

export function PlayerMessage({
  text,
  onRetry,
}: {
  text: string
  onRetry: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-court/90 p-4 text-center text-sm text-court-foreground">
      <p>{text}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

export function SkipBreaksPill({
  on,
  onToggle,
  className,
}: {
  on: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Skip breaks"
      title="Play only the rallies"
      onClick={onToggle}
      // 44 px tall target around the 30 px pill
      className={cn(
        "group flex h-11 items-center px-1.5 outline-none",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-[30px] items-center gap-[5px] whitespace-nowrap rounded-full px-3 text-xs group-focus-visible:ring-2 group-focus-visible:ring-ring",
          on
            ? "bg-chapter font-extrabold text-chapter-foreground"
            : "border border-court-foreground/35 bg-court-ink/80 font-bold text-court-foreground",
        )}
      >
        {on && <Check className="size-3.5" strokeWidth={3} />}
        {on ? "Skipping breaks" : "Skip breaks"}
      </span>
    </button>
  )
}

/** Pink "Rally 12 of 73": the rally being watched (pink = look here, DESIGN.md). */
export function RallyBadge({
  number,
  total,
}: {
  number: number
  /** "Rally 12 of 73" (player); without it just "Rally 12" (editor). */
  total?: number
}) {
  return (
    <span
      data-testid="current-rally"
      className="rounded-[8px] bg-highlight px-2.5 py-1 text-[13px] font-extrabold text-highlight-foreground tabular-nums"
    >
      Rally {number}
      {total !== undefined && ` of ${total}`}
    </span>
  )
}

/**
 * Time, previous / play-pause / next, and one trailing button (Full screen inline,
 * Exit in full screen). The same component and handlers in both modes.
 */
export function ControlRow({
  time,
  duration,
  paused,
  canPlay,
  canNavigate,
  onPrevious,
  onTogglePlay,
  onNext,
  trailing,
  className,
}: {
  time: number
  duration: number
  paused: boolean
  canPlay: boolean
  canNavigate: boolean
  onPrevious: () => void
  onTogglePlay: () => void
  onNext: () => void
  trailing: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center",
        className,
      )}
    >
      <span className="whitespace-nowrap text-[13px] tabular-nums">
        {formatDuration(time)}
        <span className="text-muted-foreground">
          {" "}
          / {formatDuration(duration)}
        </span>
      </span>
      <div className="flex items-center">
        <ControlButton
          label="Previous rally"
          title="Previous rally (←)"
          onClick={onPrevious}
          disabled={!canNavigate}
        >
          <PreviousRallyIcon className="size-5" />
        </ControlButton>
        <ControlButton
          label={paused ? "Play" : "Pause"}
          title={paused ? "Play (space)" : "Pause (space)"}
          onClick={onTogglePlay}
          disabled={!canPlay}
        >
          {paused ? (
            <PlayIcon className="size-[26px]" />
          ) : (
            <PauseIcon className="size-[26px]" />
          )}
        </ControlButton>
        <ControlButton
          label="Next rally"
          title="Next rally (→)"
          onClick={onNext}
          disabled={!canNavigate}
        >
          <NextRallyIcon className="size-5" />
        </ControlButton>
      </div>
      <div className="flex justify-end">{trailing}</div>
    </div>
  )
}
