import { useEffect, useRef } from "react"

/**
 * Player keyboard shortcuts on the window, so they work without clicking the
 * player first: e.g. { " ": togglePlay, ArrowRight: goNext }. Ignored while typing
 * or inside menus and dialogs (except our own full-screen layer); the scrubber
 * handles its own arrow keys. Plain keys only: no Ctrl / Cmd / Alt.
 */
export function usePlayerKeys(keys: Record<string, () => void>) {
  const latest = useRef(keys)
  useEffect(() => {
    latest.current = keys
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const target = event.target as HTMLElement
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='dialog']:not([data-player-fullscreen])",
        )
      )
        return
      const action = latest.current[event.key]
      if (!action) return
      const isArrow = event.key.startsWith("Arrow")
      if (isArrow && target.closest("[role='slider']")) return
      event.preventDefault() // no page scroll, and no "click" on a focused button
      action()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
