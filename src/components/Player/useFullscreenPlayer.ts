import { useRouter } from "@tanstack/react-router"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"

// Our own full-screen mode for the player (CLAUDE.md: never native video full
// screen for previews). A fixed layer over the whole viewport shows OUR player:
// iPhone's native video full screen would hand playback to Apple's player, which
// hides the rally badge, the skip pill and the chapter bar and shows the raw file's
// timeline instead.
//
// On top of the layer, where the Fullscreen API works on a normal element (desktop,
// iPad, Android), the layer also goes truly full screen and asks for landscape. On
// iPhone Safari the fixed layer alone is the full screen.

declare module "@tanstack/history" {
  interface HistoryState {
    /** The player is in full screen: Back closes it instead of leaving the page. */
    playerFullscreen?: boolean
  }
}

/** Controls fade out after this long of playback without a tap or mouse move. */
const CONTROLS_HIDE_MS = 3000

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void
}
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>
}

function canUseFullscreenApi() {
  return (
    document.fullscreenEnabled ||
    Boolean(
      (document as Document & { webkitFullscreenEnabled?: boolean })
        .webkitFullscreenEnabled,
    )
  )
}

async function lockLandscape() {
  // TODO(capacitor): in the native app, lock with the screen-orientation plugin
  // instead (`ScreenOrientation.lock({ orientation: "landscape" })` from
  // @capacitor/screen-orientation) and unlock in unlockOrientation(): the web API
  // below doesn't exist in iOS WebViews.
  try {
    await (screen.orientation as LockableOrientation).lock?.("landscape")
  } catch {
    // Not allowed here (desktop, iPhone Safari, not in full screen): fine.
  }
}

function unlockOrientation() {
  try {
    screen.orientation?.unlock?.()
  } catch {
    // nothing was locked
  }
}

/**
 * State and side effects of the player's full screen. The player renders the layer
 * (with `layerRef`) only while `active`, and moves its single <video> into it.
 *
 * Exits (button, Escape, Back, the browser leaving its own full screen) all end in
 * one place: going back over the history entry pushed on entering, so the history
 * never keeps a stale "full screen" entry.
 */
export function useFullscreenPlayer({ landscape }: { landscape: boolean }) {
  const router = useRouter()
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)
  activeRef.current = active

  /** The layer (dialog); gets real full screen where possible. */
  const layerRef = useRef<HTMLDivElement>(null)
  /** The "Full screen" button: focus goes back to it on exit. */
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** The layer is in the browser's real full screen (Fullscreen API). */
  const usingApi = useRef(false)

  // --- Controls: visible, fade out after a while of playback -----------------------
  const [controlsAwake, setControlsAwake] = useState(true)
  const hideTimer = useRef<number | undefined>(undefined)
  const wakeControls = useCallback(() => {
    setControlsAwake(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(
      () => setControlsAwake(false),
      CONTROLS_HIDE_MS,
    )
  }, [])
  const hideControls = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    setControlsAwake(false)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // --- Enter ---------------------------------------------------------------------
  const enter = () => {
    if (activeRef.current) return
    // Render the layer (and move the video into it) now, while we're still inside
    // the tap: requestFullscreen only works during a user gesture.
    flushSync(() => setActive(true))
    wakeControls()

    const layer = layerRef.current as FullscreenElement | null
    if (layer && canUseFullscreenApi()) {
      // Unprefixed returns a promise; Safari's older prefixed one returns nothing.
      const requested: Promise<void> | void = layer.requestFullscreen
        ? layer.requestFullscreen()
        : layer.webkitRequestFullscreen?.()
      Promise.resolve(requested)
        .then(() => {
          usingApi.current = true
          if (landscape) return lockLandscape()
        })
        .catch(() => {
          // Refused (e.g. not a user gesture in a test): the fixed layer still works.
        })
    }

    // Back (button or gesture) should close full screen, not leave the page: push an
    // entry for the same URL. resetScroll: false keeps the page where it was.
    const { href, state } = router.state.location
    router.navigate({
      href,
      state: { ...state, playerFullscreen: true },
      resetScroll: false,
    })
  }

  // --- Exit (all ways lead here) -----------------------------------------------------
  const exit = useCallback(() => {
    if (!activeRef.current) return
    if (router.history.location.state.playerFullscreen) {
      router.history.back() // the history listener below finishes the exit
    } else {
      setActive(false)
    }
  }, [router])

  // Leaving the full-screen entry (Back, or our own history.back()) closes it.
  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (activeRef.current && !location.state.playerFullscreen) {
          setActive(false)
        }
      }),
    [router],
  )

  // The browser left its own full screen (its Esc, Android's back gesture, its UI).
  useEffect(() => {
    const onChange = () => {
      if (usingApi.current && !document.fullscreenElement) {
        usingApi.current = false
        exit()
      }
    }
    document.addEventListener("fullscreenchange", onChange)
    document.addEventListener("webkitfullscreenchange", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      document.removeEventListener("webkitfullscreenchange", onChange)
    }
  }, [exit])

  // --- While open: page locked, Escape exits, focus managed ------------------------
  useLayoutEffect(() => {
    if (!active) return
    const html = document.documentElement
    const page = document.getElementById("root")
    const previous = {
      html: html.style.overflow,
      body: document.body.style.overflow,
    }
    // No scrolling behind the layer (iOS also scrolls the body, so lock both).
    html.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    // The page behind can't be tabbed to or read out (the layer is outside #root).
    page?.setAttribute("inert", "")
    layerRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        exit()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    const trigger = triggerRef.current
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      html.style.overflow = previous.html
      document.body.style.overflow = previous.body
      page?.removeAttribute("inert")
      // Focus back on the "Full screen" button. Leaving the browser's full screen
      // finishes later and WebKit then moves focus itself, so focus again after it.
      const refocus = () => trigger?.focus()
      if (usingApi.current && document.fullscreenElement) {
        usingApi.current = false
        document
          .exitFullscreen()
          .catch(() => {})
          .finally(refocus)
      }
      unlockOrientation()
      refocus()
      requestAnimationFrame(() => requestAnimationFrame(refocus))
    }
  }, [active, exit])

  return {
    active,
    enter,
    exit,
    layerRef,
    triggerRef,
    controlsAwake,
    wakeControls,
    hideControls,
  }
}
