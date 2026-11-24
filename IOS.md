# Running the app on your iPhone

The web app wrapped with [Capacitor](https://capacitorjs.com) as a native iOS app,
installed from Xcode with a **free Apple ID** (no paid developer account). Free installs
expire after **7 days** (see the end).

Two ways to run it:

|                        | Live reload (`bun run ios:dev`)                            | Bundled (`bun run ios:build`)  |
| ---------------------- | ---------------------------------------------------------- | ------------------------------ |
| The app loads          | the Vite dev server on your Mac (`http://<Mac's IP>:5173`) | the built files inside the app |
| After editing code     | the app reloads by itself                                  | build again and press Run      |
| Needs your Mac running | Vite and the backend                                       | the backend                    |
| Backend URL            | `http://<Mac's IP>:8000`, automatic                        | `VITE_API_URL` in `.env.ios`   |

Either way the phone and the Mac must be on the **same Wi-Fi**: the phone talks to the
backend on your Mac.

---

## 1. One-time setup on the Mac

1. **Point the command-line tools at Xcode** (right now they use the standalone
   Command Line Tools, which can't build iOS apps):

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -version        # Xcode 26.x
   ```

2. **Install the iOS platform.** Open Xcode → **Settings… (⌘,) → Components** → next to
   **iOS 26.x** click **Get** (several GB). Without it Xcode can't build for a phone
   ("iOS 26.2 is not installed"). If Xcode asks to install extra components or accept
   the license when it starts, say yes.

3. **Frontend dependencies:** `bun install` (if you haven't since pulling).

You don't need CocoaPods: the project uses Swift Package Manager, and Xcode fetches
the Capacitor packages itself the first time it opens the project.

## 2. The backend: reachable from the phone

The phone calls the backend at your Mac's LAN address, from a different origin than
the browser does, so two things change (in `../badminton-backend`):

**a. Listen on the network**, not only on localhost:

```bash
cd ../badminton-backend/backend
uv run fastapi dev --host 0.0.0.0
```

The first time, macOS may ask whether Python may accept incoming connections: click
**Allow**.

**b. Allow the app's origins (CORS).** The app's pages come from
`capacitor://localhost` (bundled) or `http://<Mac's IP>:5173` (live reload). See
["Backend change"](#backend-change-cors) below for the code; once it's in, set them in
the backend's `.env`:

```bash
# ../badminton-backend/.env (your Mac's IP: ipconfig getifaddr en0)
EXTRA_CORS_ORIGINS=capacitor://localhost,http://192.168.1.20:5173
```

and restart the backend. Both `ios:` scripts check this and print a ⚠️ line if the
backend isn't reachable or doesn't allow the origin.

## 3. One-time setup on the iPhone

1. **Connect the iPhone to the Mac with a cable.** Unlock it; on "Trust This
   Computer?" tap **Trust** and enter the passcode.
2. **Turn on Developer Mode.** On the iPhone: **Settings → Privacy & Security →
   Developer Mode** (at the bottom) → on → **Restart**. After the restart, unlock and tap
   **Turn On**.
   The switch only appears once Xcode has seen the phone. If it isn't there, open
   Xcode with the phone connected (step 4), select the phone as the run destination,
   then look again.
3. **Web Inspector** (optional, for debugging): **Settings → Apps → Safari → Advanced →
   Web Inspector** on. Then Safari on the Mac → **Develop → (your iPhone) → Rally
   Analyzer** shows the app's console and network requests.

## 4. Choose your Apple ID as the team (once)

```bash
bun run ios:open        # opens ios/App/App.xcodeproj in Xcode
```

1. In Xcode's left sidebar, click the blue **App** project at the top, then the
   **App** target (under TARGETS), then the **Signing & Capabilities** tab.
2. Tick **Automatically manage signing**.
3. **Team** → **Add an Account…** → sign in with your Apple ID. Close the Settings
   window, then pick **(your name) (Personal Team)** in the Team menu.
4. If Xcode says the **Bundle Identifier** `app.rallyanalyzer.beta` isn't available
   (every free account needs one nobody else has registered), make it unique, for
   example `app.rallyanalyzer.beta.yourname`.

Xcode saves the team (and any new bundle id) in `ios/App/App.xcodeproj/project.pbxproj`,
a tracked file; committing it is fine.

## 5. Run it

### Live reload (while developing)

```bash
bun run ios:dev
```

It finds your Mac's Wi-Fi address, points the app at the dev server, opens Xcode and
starts Vite. Keep it running. In Xcode:

1. In the toolbar at the top, click the run destination (next to "App") and choose
   **your iPhone** (not a simulator).
2. Press **Run** (▶, or ⌘R). The first build takes a few minutes (Swift packages).

**The first time** the app won't open: "Untrusted Developer". On the iPhone:
**Settings → General → VPN & Device Management → (your Apple ID) under Developer App →
Trust "…" → Trust**. Then press ▶ again.

When the app starts it asks to **find devices on your local network**: tap **Allow**
(that's how it reaches your Mac). If you tapped Don't Allow: **Settings → Privacy &
Security → Local Network → Rally Analyzer** on.

Edit code and the app reloads. **Ctrl+C** stops Vite and puts the app back on its
bundled files (otherwise it would keep looking for the dev server).

You only press ▶ again after native changes (`ios/`, new Capacitor plugins,
`capacitor.config.ts`).

### Bundled (like the real app)

```bash
cp .env.ios.example .env.ios   # once; set VITE_API_URL to http://<Mac's IP>:8000
bun run ios:build
```

Then press ▶ in Xcode (`bun run ios:open` if it's closed). The app runs from its own
files; only the backend has to be running on the Mac.

### Wireless (optional)

After one run over the cable, the phone also shows up in Xcode while it's on the same
Wi-Fi (Xcode → **Window → Devices and Simulators** → your phone → **Connect via
network**). Then you can run it without the cable.

## 6. After 7 days: reinstall

A free Apple ID signs the app for **7 days**. After that it won't open ("Rally
Analyzer is no longer available"). To renew:

1. Connect the phone (cable, or wireless as above) and unlock it.
2. Run `bun run ios:build` (or `bun run ios:dev`), then press **▶** in Xcode.

That installs a newly signed copy over the old one. Your login and settings stay
(don't delete the app first: deleting it removes them). If Xcode complains about the
provisioning profile, open **Signing & Capabilities** again and re-pick the team.

Free accounts can also have at most 3 of your own apps on a phone at a time.

---

## Add to Home Screen (quick test, no Xcode)

The web app has a manifest and Apple's home-screen tags, so Safari can install it like
an app (standalone, with the icon and the dark status bar):

1. `bun run ios:dev` (or `VITE_API_URL=http://<Mac's IP>:8000 bun run dev -- --host`)
2. On the iPhone, in Safari: `http://<Mac's IP>:5173` → **Share** → **Add to Home Screen**.

It's still Safari underneath: no native share sheet for exports (it uses the web's),
no landscape lock for full screen, and the backend must allow `http://<Mac's IP>:5173`
(step 2b). The status bar text is always light (set when installing), which suits the
default dark theme.

## Backend change (CORS)

The backend currently allows only `FRONTEND_HOST`. Add a setting for more origins
(`../badminton-backend`, a separate small commit there):

`backend/app/core/config.py`, under `FRONTEND_HOST`:

```python
    FRONTEND_HOST: str = "http://localhost:5173"
    # More origins allowed to call the API (CORS), comma-separated. The iOS app is
    # capacitor://localhost; its live-reload dev server http://<Mac's LAN IP>:5173.
    EXTRA_CORS_ORIGINS: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        extra = [o.strip().rstrip("/") for o in self.EXTRA_CORS_ORIGINS.split(",")]
        return [self.FRONTEND_HOST, *(o for o in extra if o)]
```

`backend/app/main.py`:

```diff
 app.add_middleware(
     CORSMiddleware,
-    allow_origins=[settings.FRONTEND_HOST],
+    allow_origins=settings.all_cors_origins,
```

`.env.example` (and your `.env`):

```bash
# Extra CORS origins, comma-separated: the iOS app (capacitor://localhost) and its
# live-reload dev server (http://<Mac's LAN IP>:5173)
EXTRA_CORS_ORIGINS=capacitor://localhost,http://192.168.1.20:5173
```

`FRONTEND_HOST` stays as it is: the password-reset emails link to it.

When your Mac's IP changes (another Wi-Fi network), update `EXTRA_CORS_ORIGINS` and
`.env.ios`.

## How it's set up (for reference)

- `capacitor.config.ts`: app id `app.rallyanalyzer.beta`, name, the dark background,
  splash settings. `CAP_SERVER_URL` (set by `ios:dev`) adds `server.url`.
- `scripts/ios.sh`: the two scripts. The Capacitor CLI needs Node 22+, so they run it
  with Bun (`bun --bun x cap …`); do the same if you run `cap` by hand.
- `ios/`: the Xcode project (committed). `ios/App/App/public` and
  `capacitor.config.json` are copies made by `cap sync` (gitignored).
- **Local HTTP, Debug builds only:** a build phase ("Allow local network (Debug)") adds
  App Transport Security's `NSAllowsLocalNetworking` (plain HTTP to your Mac) and the
  local-network prompt's text to Debug builds. Release builds (archives for
  TestFlight / the App Store) don't get it and will need an HTTPS backend.
- **Portrait only**, except the player's full screen: `MainViewController`
  (`ios/App/App/SceneDelegate.swift`) starts iPhones in portrait; the full screen
  locks landscape with `@capacitor/screen-orientation` and unlocks back to portrait.
  iPads rotate freely.
- **Status bar and splash:** `src/lib/native.ts`. The status bar text follows the
  app's theme, hides in the player's full screen; the splash (dark, the app mark) stays
  until the first screen is drawn.
- **Share:** exports are downloaded natively and shared with `@capacitor/share` (the
  share sheet has Save Video), so the app shows one "Save or share" button.
- **Icons and splash images:** `bun run icons` (`scripts/make-icons.ts`) draws them from
  the app mark into `public/icons` and the Xcode asset catalog.
