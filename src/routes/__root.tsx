import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { createRootRoute, HeadContent, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import ErrorComponent from "@/components/Common/ErrorComponent"
import NotFound from "@/components/Common/NotFound"
import { RotateToPortrait } from "@/components/Common/RotateToPortrait"

// Dev builds only (they render nothing in production), and not under test automation:
// their floating buttons would sit on the video screen's pinned tool row.
const showDevtools = !navigator.webdriver

export const Route = createRootRoute({
  component: () => (
    <>
      <HeadContent />
      <Outlet />
      <RotateToPortrait />
      {showDevtools && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools initialIsOpen={false} />
        </>
      )}
    </>
  ),
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
