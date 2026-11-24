import { Capacitor } from "@capacitor/core"
import { ScreenOrientation } from "@capacitor/screen-orientation"
import { SplashScreen } from "@capacitor/splash-screen"
import { StatusBar, Style } from "@capacitor/status-bar"

// What the iOS / Android app (Capacitor, IOS.md) does differently from a browser.
// Every function here is a no-op in a browser, and never throws: a missing plugin or
// a refused request must not break the page.

/** Running inside the native app, not a browser. */
export const isNativeApp = Capacitor.isNativePlatform()

const ignore = () => {}

/**
 * The bars around the page follow the app's theme (not the phone's): the native
 * status bar's text (light on dark, dark on light), and `theme-color` (the browser's
 * and a home-screen app's bar color) = the theme's --background. Call after the theme
 * class is on <html>.
 */
export function applySystemChrome(theme: "dark" | "light") {
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim()
  if (background)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background)
  if (isNativeApp)
    StatusBar.setStyle({
      style: theme === "dark" ? Style.Dark : Style.Light,
    }).catch(ignore)
}

/** The splash screen stays up (3 s at most) until the first screen is drawn. */
export function hideSplash() {
  if (isNativeApp) SplashScreen.hide().catch(ignore)
}

/**
 * The player's full screen in the app: no status bar, and landscape for a landscape
 * video. Phones are portrait-only otherwise (MainViewController in
 * ios/App/App/SceneDelegate.swift); `exitNativeFullscreen` goes back to that.
 */
export function enterNativeFullscreen({ landscape }: { landscape: boolean }) {
  if (!isNativeApp) return
  StatusBar.hide().catch(ignore)
  if (landscape)
    ScreenOrientation.lock({ orientation: "landscape" }).catch(ignore)
}

export function exitNativeFullscreen() {
  if (!isNativeApp) return
  StatusBar.show().catch(ignore)
  ScreenOrientation.unlock().catch(ignore)
}

/**
 * Share a file at a URL with the system share sheet (Save Video, Messages, AirDrop…).
 * The file is downloaded natively into the app's cache first: the share sheet takes
 * files, and WKWebView's Web Share API can't share them. "cancelled" = the sheet was
 * closed. The plugins load on first use (most screens never share).
 */
export async function shareFileNatively({
  url,
  filename,
  title,
}: {
  url: string
  filename: string
  title: string
}): Promise<"shared" | "cancelled"> {
  const [{ Directory, Filesystem }, { FileTransfer }, { Share }] =
    await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/file-transfer"),
      import("@capacitor/share"),
    ])
  const { uri } = await Filesystem.getUri({
    directory: Directory.Cache,
    path: filename,
  })
  await FileTransfer.downloadFile({ url, path: uri })
  try {
    await Share.share({ files: [uri], title })
    return "shared"
  } catch (error) {
    // The plugin rejects with "Share canceled" when the sheet is closed
    if (/cancel/i.test(String((error as Error)?.message ?? error)))
      return "cancelled"
    throw error
  } finally {
    // A video can be large: don't keep the copy (the share has finished with it)
    Filesystem.deleteFile({ directory: Directory.Cache, path: filename }).catch(
      ignore,
    )
  }
}
