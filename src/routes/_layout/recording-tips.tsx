import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, ChevronLeft, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TIPS } from "@/components/Videos/RecordingTips"
import { LIMITS_TEXT } from "@/components/Videos/uploadLimits"

export const Route = createFileRoute("/_layout/recording-tips")({
  component: RecordingTipsPage,
  head: () => ({
    meta: [{ title: "How to record - Rally Analyzer" }],
  }),
})

function RecordingTipsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
        <Link to="/upload">
          <ChevronLeft />
          Upload
        </Link>
      </Button>
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">
          How to record a match
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Two minutes of setup make the rallies we find much more accurate.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <figure className="flex flex-col gap-2">
          <SideView />
          <figcaption className="text-[13px] text-muted-foreground">
            From the side: phone high up, behind one baseline.
          </figcaption>
        </figure>
        <figure className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <CameraView good />
            <CameraView good={false} />
          </div>
          <figcaption className="text-[13px] text-muted-foreground">
            What the phone sees: all four corners, both baselines.
          </figcaption>
        </figure>
      </div>

      <ol className="flex flex-col gap-2">
        {TIPS.map(({ Icon, title, detail }, index) => (
          <li key={title} className="flex gap-3 rounded-xl bg-card p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-success-soft text-success-text">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-extrabold">
                <span className="text-muted-foreground tabular-nums">
                  {index + 1}.{" "}
                </span>
                {title}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-[13px] text-muted-foreground">
        Each video can be {LIMITS_TEXT}. For a longer session, record it in
        parts.
      </p>

      <Button asChild size="lg" className="self-start max-sm:w-full">
        <Link to="/upload">
          <Upload />
          Upload a match
        </Link>
      </Button>
    </div>
  )
}

/** Side view: floor, net, and the phone on a tall tripod behind the near baseline. */
function SideView() {
  return (
    <svg
      viewBox="0 0 320 150"
      className="w-full rounded-xl bg-court"
      role="img"
      aria-label="Side view: the phone on a tall tripod behind the near baseline, looking down the whole court to the far baseline"
    >
      {/* sight lines from the phone to both baselines */}
      <path
        d="M52 46 L92 124 M52 46 L298 124"
        className="stroke-court-accent"
        strokeWidth={1.2}
        strokeDasharray="4 4"
        fill="none"
      />
      {/* floor and court */}
      <path d="M12 124 H310" className="stroke-court-muted" strokeWidth={1} />
      <path d="M92 124 H298" className="stroke-court-line" strokeWidth={4} />
      {/* net */}
      <path
        d="M195 124 V92 M195 94 H197"
        className="stroke-court-foreground"
        strokeWidth={2}
      />
      {/* tripod + phone */}
      <path
        d="M44 54 V124 M44 70 L30 124 M44 70 L58 124"
        className="stroke-court-foreground"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <rect
        x="37"
        y="38"
        width="16"
        height="12"
        rx="2"
        className="fill-court-foreground"
      />
      {/* height marker */}
      <path
        d="M18 120 V48 M14 52 L18 46 L22 52"
        className="stroke-court-accent"
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <g className="fill-court-foreground text-[10px] font-bold">
        <text x="62" y="30">
          Phone: high, behind the baseline
        </text>
        <text x="182" y="86">
          Net
        </text>
        <text x="236" y="142">
          Far baseline
        </text>
        <text x="62" y="142">
          Near baseline
        </text>
      </g>
    </svg>
  )
}

/** The phone's picture: the whole court (good) vs far corners cut off (bad). */
function CameraView({ good }: { good: boolean }) {
  // Same court, drawn bigger and lower when the phone is too low / zoomed in.
  const court = good
    ? "M54 18 L106 18 L144 78 L16 78 Z"
    : "M42 -12 L118 -12 L178 88 L-18 88 Z"
  const net = good ? "M37 45 H123" : "M17 32 H143"
  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox="0 0 160 90"
        className="w-full overflow-hidden rounded-[10px] bg-court"
        role="img"
        aria-label={
          good
            ? "Good: the whole court is in the picture"
            : "Not good: the far corners are cut off"
        }
      >
        <path
          d={court}
          className="stroke-court-line"
          strokeWidth={2}
          fill="none"
        />
        <path d={net} className="stroke-court-foreground" strokeWidth={1.5} />
      </svg>
      <span
        className={
          good
            ? "flex items-center gap-1 text-xs font-bold text-success-text"
            : "flex items-center gap-1 text-xs font-bold text-highlight-text"
        }
      >
        {good ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        {good ? "Whole court" : "Corners cut off"}
      </span>
    </div>
  )
}
