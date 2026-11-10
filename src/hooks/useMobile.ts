import * as React from "react"

/**
 * The desktop layout's media query, the same as the `md` variant in index.css:
 * wide AND tall. A phone held sideways (wide but short) stays "mobile", so it gets
 * the tab bar and the sidebar stays a hidden sheet.
 */
export const DESKTOP_QUERY = "(min-width: 768px) and (min-height: 480px)"

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsMobile(!mql.matches)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
