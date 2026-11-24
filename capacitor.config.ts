import type { CapacitorConfig } from "@capacitor/cli"

// The iOS app (IOS.md). Two ways to run it:
// - bundled: `bun run ios:build` builds dist/ with .env.ios and copies it into the app
// - live reload: `bun run ios:dev` sets CAP_SERVER_URL to the Vite dev server on this
//   Mac's LAN address, so the app loads the page from there (and reloads on save)
// Both write ios/App/App/capacitor.config.json; the last sync wins.

/** The theme's dark background (DESIGN.md / index.css `.dark --background`): the
 * default theme, so the web view and the splash screen are this color before the
 * page paints. */
const DARK_BACKGROUND = "#191923"

const devServer = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: "app.rallyanalyzer.beta",
  appName: "Rally Analyzer",
  webDir: "dist",
  backgroundColor: DARK_BACKGROUND,
  ios: {
    // The page runs under the status bar and home indicator and pads itself with
    // env(safe-area-inset-*) (viewport-fit=cover in index.html)
    contentInset: "never",
  },
  ...(devServer && {
    server: { url: devServer, cleartext: true },
  }),
  plugins: {
    SplashScreen: {
      // main.tsx hides it once the first screen is drawn; this is only the ceiling
      // (e.g. the dev server isn't reachable and the page never loads)
      launchShowDuration: 3000,
      launchFadeOutDuration: 200,
      backgroundColor: DARK_BACKGROUND,
      showSpinner: false,
    },
  },
}

export default config
