import { Smartphone } from "lucide-react"

/**
 * The app is portrait-only on phones. A web page can't lock the screen's rotation
 * (browsers allow that only in full screen), so a phone held sideways sees this
 * instead of a squeezed page. Full-screen video is unaffected: only the full-screen
 * element is drawn then. The Capacitor app will lock portrait natively.
 * `phone-landscape` (index.css) = a touch screen, landscape, under 480 px tall.
 */
export function RotateToPortrait() {
  return (
    <div
      role="status"
      data-testid="rotate-to-portrait"
      className="fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-3 bg-background px-6 text-center phone-landscape:flex"
    >
      <span className="flex size-14 items-center justify-center rounded-[18px] bg-success-soft text-success-text">
        <Smartphone className="size-7" />
      </span>
      <p className="text-[15px] font-extrabold">Turn your phone upright</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">
        Rally Analyzer works in portrait. Full-screen videos can still go
        sideways.
      </p>
    </div>
  )
}
