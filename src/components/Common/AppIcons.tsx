import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

// Icons from the DESIGN.md mockups that lucide doesn't have. They draw with
// currentColor, so color comes from tokens on the parent.

/** Bar chart on a baseline: the app's mark. */
export function RallyBarsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 18h16" />
      <path d="M7 18V9" />
      <path d="M12 18V5" />
      <path d="M17 18v-6" />
    </svg>
  )
}

/** Video frame with a play triangle: the "Matches" tab. */
export function MatchesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 9.5v5l4-2.5z" fill="currentColor" />
    </svg>
  )
}

/** The app mark: rounded green square with the bars (header, sidebar, login). */
export function AppMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground",
        className,
      )}
    >
      <RallyBarsIcon className="size-[18px]" />
    </span>
  )
}

// --- Player controls (filled, as in the player mockup) -------------------------------

type IconProps = SVGProps<SVGSVGElement>
const filled = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "currentColor",
  ...props,
})

export function PlayIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...filled(props)}>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...filled(props)}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

export function PreviousRallyIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...filled(props)}>
      <path d="M18 19L8.5 12 18 5v14z" />
      <rect x="5" y="5" width="2.2" height="14" rx="1" />
    </svg>
  )
}

export function NextRallyIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...filled(props)}>
      <path d="M6 5l9.5 7L6 19V5z" />
      <rect x="16.8" y="5" width="2.2" height="14" rx="1" />
    </svg>
  )
}

const outlined = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
})

export function FullscreenIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...outlined(props)}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  )
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...outlined(props)}>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </svg>
  )
}
