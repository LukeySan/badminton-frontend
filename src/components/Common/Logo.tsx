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
            "truncate text-[18px] font-extrabold",
            variant === "responsive" && "group-data-[collapsible=icon]:hidden",
          )}
        >
          Rally Analyzer
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
