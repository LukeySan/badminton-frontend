import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router"

import { BottomTabBar } from "@/components/Common/BottomTabBar"
import { Footer } from "@/components/Common/Footer"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

function Layout() {
  // Video pages (player, court, processing) are full-screen views with a back
  // button, like the player mockup: no tab bar there.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const showTabBar = !pathname.startsWith("/videos/")
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Desktop (md+) keeps the sidebar and its toggle; phones use the tab bar */}
        <header className="sticky top-0 z-10 hidden h-16 shrink-0 items-center gap-2 border-b bg-background px-4 md:flex">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
        </header>
        <main
          className={cn(
            "flex-1 p-4 sm:px-6 sm:pt-6 md:p-8",
            // Phones: room at the bottom for the fixed tab bar (76 px + safe area)
            showTabBar && "pb-[calc(76px+env(safe-area-inset-bottom)+1.5rem)]",
          )}
        >
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
        <div className="hidden md:block">
          <Footer />
        </div>
        {showTabBar && <BottomTabBar />}
      </SidebarInset>
    </SidebarProvider>
  )
}
