import { Link, useRouterState } from "@tanstack/react-router"
import { Plus, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { MatchesIcon } from "./AppIcons"

const tab =
  "flex h-14 flex-col items-center justify-center gap-[3px] text-[11px] outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Phone navigation (DESIGN.md "Navigation"): Matches, a raised Upload button,
 * Profile. Hidden from md up, where the sidebar takes over.
 */
export function BottomTabBar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // Video pages (player, court, status) belong to Matches.
  const matchesActive = pathname === "/" || pathname.startsWith("/videos")
  const profileActive = pathname.startsWith("/settings")

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 items-center border-t border-track md:hidden",
        "bg-card dark:bg-background",
        // 76 px bar + the iPhone home-indicator area (Capacitor)
        "h-[calc(76px+env(safe-area-inset-bottom))] pb-[calc(8px+env(safe-area-inset-bottom))]",
      )}
    >
      <Link
        to="/"
        aria-current={matchesActive ? "page" : undefined}
        className={cn(
          tab,
          matchesActive
            ? "font-extrabold text-foreground"
            : "font-bold text-muted-foreground",
        )}
      >
        <MatchesIcon className="size-[22px]" />
        Matches
      </Link>
      <Link
        to="/upload"
        aria-label="Upload a video"
        aria-current={pathname === "/upload" ? "page" : undefined}
        className="group flex h-14 items-center justify-center outline-none"
      >
        <span className="flex size-[52px] items-center justify-center rounded-[18px] bg-primary text-primary-foreground transition-transform group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background group-active:scale-95">
          <Plus className="size-6" strokeWidth={2.6} />
        </span>
      </Link>
      <Link
        to="/settings"
        aria-current={profileActive ? "page" : undefined}
        className={cn(
          tab,
          profileActive
            ? "font-extrabold text-foreground"
            : "font-bold text-muted-foreground",
        )}
      >
        <User className="size-[22px]" />
        Profile
      </Link>
    </nav>
  )
}
