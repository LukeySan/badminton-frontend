import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { cn } from "@/lib/utils"

// Everything here reads the *rendered* colors (getComputedStyle), so each panel shows
// the real values of its own theme, and the contrast numbers are measured, not typed.

// --- Color helpers --------------------------------------------------------------

type RGBA = [number, number, number, number] // 0-255, alpha 0-1

let canvasContext: CanvasRenderingContext2D | null = null
/** Any CSS color the browser understands (rgb, hex, oklab, color-mix…) → RGBA. */
function parseColor(color: string): RGBA {
  if (!canvasContext) {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    canvasContext = canvas.getContext("2d", { willReadFrequently: true })!
  }
  const ctx = canvasContext
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = "#000"
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b, a / 255]
}

function blend([r, g, b, a]: RGBA, [br, bg, bb]: RGBA): RGBA {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
}

/** Background actually seen behind an element: semi-transparent layers composited. */
function effectiveBackground(element: Element): RGBA {
  const layers: RGBA[] = []
  for (let el: Element | null = element; el; el = el.parentElement) {
    const color = parseColor(getComputedStyle(el).backgroundColor)
    if (color[3] > 0) layers.push(color)
    if (color[3] >= 1) break
  }
  return layers.reduceRight<RGBA>(
    (under, layer) => blend(layer, under),
    [255, 255, 255, 1],
  )
}

function luminance([r, g, b]: RGBA): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

/** WCAG contrast ratio (1-21). */
function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// --- Layout helpers ----------------------------------------------------------------

export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      {children}
    </section>
  )
}

// --- Swatches -------------------------------------------------------------------------

const SHADCN_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "subtle-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-accent",
]

const CUSTOM_TOKENS = [
  "court",
  "court-foreground",
  "court-line",
  "chapter",
  "chapter-foreground",
  "chapter-dim",
  "track",
  "highlight",
  "highlight-foreground",
  "highlight-text",
  "highlight-text-strong",
  "highlight-soft",
  "success-text",
  "success-soft",
  "sheet",
  "overlay",
]

function Swatch({ token }: { token: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState("")
  useLayoutEffect(() => {
    // The value as written in index.css for this panel's theme (exact, incl. rgba).
    if (ref.current)
      setValue(
        getComputedStyle(ref.current).getPropertyValue(`--${token}`).trim(),
      )
  }, [token])
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        ref={ref}
        className="size-9 shrink-0 rounded-md border"
        // Reads the token itself (no hard-coded color): shows this panel's value.
        style={{ backgroundColor: `var(--${token})` }}
      />
      <div className="min-w-0 text-xs leading-tight">
        {/* mono: Manrope joins "--" into a dash */}
        <p className="truncate font-mono font-bold">--{token}</p>
        <p className="font-mono text-muted-foreground tabular-nums">{value}</p>
      </div>
    </div>
  )
}

export function TokenSwatches() {
  return (
    <>
      <Section title="shadcn tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SHADCN_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </Section>
      <Section title="Custom tokens (bg-court, text-highlight-text, …)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CUSTOM_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </Section>
    </>
  )
}

// --- Contrast -------------------------------------------------------------------------

/**
 * Measures text against what is really behind it. The sample is the first element of
 * `children`, or (`select`) an element inside it, or (`find`) an element elsewhere in
 * this theme panel, e.g. the form error message, which appears a moment later.
 */
function ContrastRow({
  label,
  children,
  select,
  find,
}: {
  label: string
  children?: ReactNode
  select?: string
  find?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  useEffect(() => {
    let frame = 0
    let tries = 0
    const measure = () => {
      const row = ref.current
      if (!row) return
      const sample = find
        ? row.closest("[data-testid^='panel-']")?.querySelector(find)
        : select
          ? row.querySelector(`[data-sample] ${select}`)
          : row.querySelector("[data-sample]")?.firstElementChild
      if (!sample) {
        if (tries++ < 120) frame = requestAnimationFrame(measure)
        return
      }
      const background = effectiveBackground(sample)
      const text = blend(parseColor(getComputedStyle(sample).color), background)
      setRatio(contrast(text, background))
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [find, select])
  const level =
    ratio === null ? "" : ratio >= 4.5 ? "pass" : ratio >= 3 ? "large" : "fail"
  return (
    <div
      ref={ref}
      className="flex items-center gap-3 text-sm"
      data-testid="contrast-row"
      data-level={level}
    >
      <div data-sample className="w-32 shrink-0">
        {children ?? (
          <span className="text-xs text-muted-foreground">(below)</span>
        )}
      </div>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {label}
      </p>
      <span className="w-12 text-right font-bold tabular-nums">
        {ratio?.toFixed(2)}
      </span>
      <span
        className={cn(
          "w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-extrabold",
          level === "pass" && "bg-success-soft text-success-text",
          level === "large" && "border text-muted-foreground",
          level === "fail" && "bg-highlight text-highlight-foreground",
        )}
      >
        {level === "pass"
          ? "AA"
          : level === "large"
            ? "Large only"
            : level
              ? "Fail"
              : "…"}
      </span>
    </div>
  )
}

const chip = "inline-block rounded-md px-2 py-1 text-sm font-semibold"

export function ContrastChecks() {
  return (
    <Section title="Contrast (measured; body text needs 4.5:1)">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold text-muted-foreground">Token pairs</p>
        <ContrastRow label="foreground on background">
          <span className={cn(chip, "bg-background text-foreground")}>
            Body
          </span>
        </ContrastRow>
        <ContrastRow label="muted-foreground on background">
          <span className={cn(chip, "bg-background text-muted-foreground")}>
            Muted
          </span>
        </ContrastRow>
        <ContrastRow label="muted-foreground on card">
          <span className={cn(chip, "bg-card text-muted-foreground")}>
            Muted
          </span>
        </ContrastRow>
        <ContrastRow label="muted-foreground on sheet">
          <span className={cn(chip, "bg-sheet text-muted-foreground")}>
            4.2 s
          </span>
        </ContrastRow>
        <ContrastRow label="subtle-foreground on sheet (rally lengths)">
          <span className={cn(chip, "bg-sheet text-subtle-foreground")}>
            4.2s
          </span>
        </ContrastRow>
        <ContrastRow label="subtle-foreground on secondary (sort pill)">
          <span className={cn(chip, "bg-secondary text-subtle-foreground")}>
            Longest
          </span>
        </ContrastRow>
        <ContrastRow
          label="court-foreground on court-ink/80 (skip pill off)"
          select="span span"
        >
          <span className="inline-block rounded-md bg-court">
            <span className={cn(chip, "bg-court-ink/80 text-court-foreground")}>
              Skip breaks
            </span>
          </span>
        </ContrastRow>
        <ContrastRow label="primary on background (links, icons)">
          <span className={cn(chip, "bg-background text-primary")}>Link</span>
        </ContrastRow>
        <ContrastRow label="secondary-foreground on secondary">
          <span className={cn(chip, "bg-secondary text-secondary-foreground")}>
            Second
          </span>
        </ContrastRow>
        <ContrastRow label="accent-foreground on accent">
          <span className={cn(chip, "bg-accent text-accent-foreground")}>
            Accent
          </span>
        </ContrastRow>
        <ContrastRow label="highlight-foreground on highlight (rally badge)">
          <span className={cn(chip, "bg-highlight text-highlight-foreground")}>
            Rally 12
          </span>
        </ContrastRow>
        <ContrastRow label="highlight-text on background">
          <span className={cn(chip, "bg-background text-highlight-text")}>
            #12
          </span>
        </ContrastRow>
        <ContrastRow label="highlight-text on highlight-soft (current row)">
          <span className={cn(chip, "bg-highlight-soft text-highlight-text")}>
            #12
          </span>
        </ContrastRow>
        <ContrastRow label="highlight-text-strong on highlight/16 (Failed pill)">
          <span
            className={cn(chip, "bg-highlight/16 text-highlight-text-strong")}
          >
            Failed
          </span>
        </ContrastRow>
        <ContrastRow label="success-text on success-soft (Ready pill)">
          <span className={cn(chip, "bg-success-soft text-success-text")}>
            Ready
          </span>
        </ContrastRow>
        <ContrastRow label="success-text on background">
          <span className={cn(chip, "bg-background text-success-text")}>
            5:09
          </span>
        </ContrastRow>
        <ContrastRow label="chapter-foreground on chapter (skip pill, handles)">
          <span className={cn(chip, "bg-chapter text-chapter-foreground")}>
            ✓ Skipping
          </span>
        </ContrastRow>
        <ContrastRow label="court-foreground on court (featured card)">
          <span className={cn(chip, "bg-court text-court-foreground")}>
            Last match
          </span>
        </ContrastRow>
        <ContrastRow label="court-foreground on court/90 (message on video)">
          <span className={cn(chip, "bg-court/90 text-court-foreground")}>
            Can't play
          </span>
        </ContrastRow>

        <p className="mt-2 text-xs font-bold text-muted-foreground">
          Real components
        </p>
        <ContrastRow label="Button default">
          <Button size="sm">Analyze</Button>
        </ContrastRow>
        <ContrastRow label="Button destructive">
          <Button size="sm" variant="destructive">
            Delete
          </Button>
        </ContrastRow>
        <ContrastRow label="LoadingButton destructive">
          <LoadingButton size="sm" variant="destructive">
            Delete
          </LoadingButton>
        </ContrastRow>
        <ContrastRow label="Badge destructive (Failed status)">
          <Badge variant="destructive">Failed</Badge>
        </ContrastRow>
        <ContrastRow label="Badge default (Ready status)">
          <Badge>Ready</Badge>
        </ContrastRow>
        <ContrastRow
          label="Alert destructive: title"
          select="[data-slot=alert-title]"
        >
          <Alert variant="destructive" className="px-2 py-1">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Try again</AlertDescription>
          </Alert>
        </ContrastRow>
        <ContrastRow
          label="Alert destructive: description"
          select="[data-slot=alert-description]"
        >
          <Alert variant="destructive" className="px-2 py-1">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Try again</AlertDescription>
          </Alert>
        </ContrastRow>
        <ContrastRow
          label="FormMessage (form error, in the Form example)"
          find="[data-slot=form-message]"
        />
        <ContrastRow label="Dropdown destructive item (its classes, on popover)">
          <span className={cn(chip, "bg-popover text-highlight-text")}>
            Delete
          </span>
        </ContrastRow>
        <ContrastRow
          label="Avatar (initials)"
          select="[data-slot=avatar-fallback]"
        >
          <Avatar>
            <AvatarFallback className="border bg-card text-[13px] font-extrabold text-card-foreground">
              BL
            </AvatarFallback>
          </Avatar>
        </ContrastRow>
      </div>
    </Section>
  )
}

// --- Type, radius, tokens in use -----------------------------------------------------------

export function TypeScale() {
  return (
    <Section title="Typography (Manrope)">
      <div className="flex flex-col gap-2">
        <p className="text-[26px] font-extrabold tracking-[-0.01em]">
          Page title 26/800
        </p>
        <p className="text-[18px] font-extrabold">App name 18/800</p>
        <p className="text-[15px] font-extrabold">Section title 15/800</p>
        <p className="text-sm">
          Body 14 — the quick brown fox jumps over the lazy dog.
        </p>
        <p className="text-[13px] text-muted-foreground">
          Secondary 13 · uploaded Nov 6
        </p>
        <p className="text-xs text-muted-foreground">Secondary 12</p>
        <p className="text-[20px] font-extrabold tabular-nums">
          5:09 · stat 20/800
        </p>
        <p className="text-[11px] font-extrabold">BADGE 11/800</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="font-normal">400</span>
          <span className="font-medium">500</span>
          <span className="font-semibold">600</span>
          <span className="font-bold">700</span>
          <span className="font-extrabold">800</span>
        </div>
        <p className="text-[13px] tabular-nums">
          tabular-nums: 1:11 / 21:24 · 11.1 s · 8.8 s
        </p>
      </div>
    </Section>
  )
}

export function RadiusScale() {
  const items = [
    ["rounded-sm", "10px"],
    ["rounded-md", "12px · buttons"],
    ["rounded-lg", "14px · list items"],
    ["rounded-xl", "18px · cards"],
    ["rounded-full", "pills"],
  ]
  return (
    <Section title="Radius (--radius 14px)">
      <div className="flex flex-wrap gap-3">
        {items.map(([cls, note]) => (
          <div key={cls} className="flex flex-col items-center gap-1 text-xs">
            <div
              className={cn("size-14 border-2 border-chapter bg-card", cls)}
            />
            <span className="font-bold">{cls}</span>
            <span className="text-muted-foreground">{note}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

/** The custom tokens as DESIGN.md uses them (previews, not the real components yet). */
export function TokensInUse() {
  const rallies = [
    [4, 9],
    [14, 22],
    [27, 30],
    [36, 47],
    [55, 58],
    [63, 71],
    [80, 84],
    [90, 96],
  ]
  const current = 3
  const dimmed = new Set([2, 4])
  return (
    <Section title="Tokens in use">
      {/* Chapter scrubber: track, chapters, dimmed (filtered out), current, playhead */}
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-[6px] bg-track">
          {rallies.map(([start, end], i) => (
            <div
              key={start}
              className={cn(
                "absolute",
                i === current
                  ? "-inset-y-[3px] min-w-1 rounded-[2px] bg-highlight"
                  : "inset-y-0 min-w-0.5",
                i !== current &&
                  (dimmed.has(i) ? "bg-chapter-dim" : "bg-chapter"),
              )}
              style={{ left: `${start}%`, width: `${end - start}%` }}
            />
          ))}
        </div>
        <div
          className="absolute -inset-y-px w-1 rounded-full bg-foreground ring-2 ring-background"
          style={{ left: "40%" }}
        />
      </div>

      {/* Skip-breaks pill on a video: on / off */}
      <div className="relative flex h-16 items-end justify-end gap-2 rounded-lg bg-court p-2">
        <span className="inline-flex h-[30px] items-center rounded-full bg-chapter px-3 text-xs font-bold text-chapter-foreground">
          ✓ Skipping breaks
        </span>
        <span className="inline-flex h-[30px] items-center rounded-full bg-court/80 px-3 text-xs font-bold text-court-foreground ring-1 ring-court-foreground/40">
          Skip breaks
        </span>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-[22px] items-center rounded-full bg-success-soft px-2.5 text-[11px] font-extrabold text-success-text">
          Ready · 73 rallies
        </span>
        <span className="inline-flex h-[22px] items-center gap-2 rounded-full border px-2.5 text-[11px] font-extrabold">
          Analyzing 42%
          <span className="relative h-1 w-10 overflow-hidden rounded-full bg-track">
            <span className="absolute inset-y-0 left-0 w-[42%] bg-chapter" />
          </span>
        </span>
        <span className="inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-extrabold">
          Mark the court ›
        </span>
        <span className="inline-flex h-[22px] items-center rounded-full bg-highlight/16 px-2.5 text-[11px] font-extrabold text-highlight-text-strong">
          Failed · Try again
        </span>
        <span className="inline-flex h-[22px] items-center rounded-full bg-highlight px-2.5 text-[11px] font-extrabold text-highlight-foreground">
          Rally 12 of 73
        </span>
      </div>

      {/* Rally rows on the sheet: normal + current */}
      <div className="flex flex-col gap-1 rounded-t-[22px] bg-sheet p-3">
        {[
          { n: 11, start: "4:02", len: 3.1, current: false },
          { n: 12, start: "4:12", len: 8.4, current: true },
          { n: 13, start: "4:31", len: 5.6, current: false },
        ].map((row) => (
          <div
            key={row.n}
            className={cn(
              "flex h-[50px] items-center gap-3 rounded-lg px-3 text-sm tabular-nums",
              row.current &&
                "bg-highlight-soft outline-[1.5px] outline-highlight outline-solid",
            )}
          >
            <span
              className={cn(
                "w-8 font-bold text-muted-foreground",
                row.current && "text-highlight-text",
              )}
            >
              #{row.n}
            </span>
            <span className="w-10">{row.start}</span>
            <span className="flex-1">
              <span
                className={cn(
                  "block h-2 rounded-full",
                  row.current ? "bg-highlight" : "bg-chapter",
                )}
                style={{ width: `${(row.len / 8.4) * 100}%` }}
              />
            </span>
            <span className="w-10 text-right text-muted-foreground">
              {row.len}s
            </span>
          </div>
        ))}
      </div>

      {/* Court thumbnail + featured card */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-court">
          <div className="absolute inset-x-3 inset-y-2 border border-court-line" />
          <div className="absolute inset-x-3 top-1/2 h-px bg-court-line" />
          <span className="absolute right-1 bottom-1 rounded bg-court/80 px-1 text-[10px] font-bold text-court-foreground tabular-nums">
            21:24
          </span>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1 rounded-xl bg-court p-4 text-court-foreground">
          <span className="text-xs font-bold">Last match</span>
          <span className="text-[22px] font-extrabold tabular-nums">
            5:09 of play
          </span>
          <span className="text-xs">out of 21:24 recorded</span>
        </div>
      </div>
    </Section>
  )
}
