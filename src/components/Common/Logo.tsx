import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"
import { AppMark } from "./AppIcons"

interface LogoProps {
  /** responsive = full, but only the mark when the desktop sidebar is collapsed */
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

/** App mark + "Rally Analyzer" (DESIGN.md: app name 18/800). */
export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const content = (
    <span className={cn("flex items-center gap-2.5", className)}>
      <AppMark />
      {variant !== "icon" && (
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            variant === "responsive" && "group-data-[collapsible=icon]:hidden",
          )}
        >
          <span className="truncate text-[18px] font-extrabold">
            Rally Analyzer
          </span>
          <BetaTag />
        </span>
      )}
    </span>
  )

  if (!asLink) return content
  return (
    <Link to="/" aria-label="Rally Analyzer, home">
      {content}
    </Link>
  )
}

/** "Beta" next to the app name: green, since pink means "look here" (DESIGN.md). */
export function BetaTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full bg-success-soft px-1.5 text-[10px] font-extrabold tracking-[0.04em] text-success-text uppercase",
        className,
      )}
    >
      Beta
    </span>
  )
}
