import {
  Minus,
  Plus,
  RectangleVertical,
  Scissors,
  Spline,
  Timer,
  Trash2,
  Type,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import type { ReelClip } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { CAPTION_MAX, type Edit, TRIM_SNAP } from "./reelEdit"

/** "0:41.2": trim times need tenths. */
export function formatTenths(seconds: number) {
  const tenths = Math.round(seconds * 10)
  const m = Math.floor(tenths / 600)
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, "0")
  return `${m}:${s}`
}

/**
 * Below the timeline: what's selected, the precise trim controls (Trim tool), and
 * the tools. Every change is a callback that goes through the reducer.
 */
export function EditTools({
  edit,
  clip,
  clipLabel,
  caption,
  onNudge,
  onToggleSlowMo,
  onSetTrail,
  onSetCaption,
  onToggleFormat,
  onRemove,
}: {
  edit: Edit
  /** The selected clip (undefined: nothing selected). */
  clip: ReelClip | undefined
  /** "Rally 19" */
  clipLabel: string
  caption: string | undefined
  onNudge: (edge: "start" | "end", delta: number) => void
  onToggleSlowMo: () => void
  onSetTrail: (on: boolean) => void
  onSetCaption: (text: string) => void
  onToggleFormat: () => void
  onRemove: () => void
}) {
  const [trimOpen, setTrimOpen] = useState(false)
  const [captionOpen, setCaptionOpen] = useState(false)
  const hasClip = clip !== undefined

  return (
    <>
      <div className="flex h-7 shrink-0 items-center px-4 text-xs text-muted-foreground md:px-0">
        {hasClip ? (
          <span>
            <span className="font-extrabold text-highlight-text">
              {clipLabel}
            </span>{" "}
            selected · drag the pink edges to trim
          </span>
        ) : (
          <span>Tap a clip on the timeline to select it.</span>
        )}
      </div>

      {trimOpen && hasClip && (
        <fieldset className="m-0 flex min-w-0 shrink-0 items-center justify-between gap-2 border-0 px-3 pb-1 md:px-0">
          <legend className="sr-only">Trim {clipLabel}</legend>
          <Nudge
            label="Start"
            value={clip.trim_start}
            onNudge={(delta) => onNudge("start", delta)}
          />
          <Nudge
            label="End"
            value={clip.trim_end}
            onNudge={(delta) => onNudge("end", delta)}
          />
        </fieldset>
      )}

      <div
        role="toolbar"
        aria-label="Edit tools"
        className="flex shrink-0 gap-2 overflow-x-auto border-t border-track px-3 pt-1 pb-[max(1.375rem,env(safe-area-inset-bottom))] [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <Tool
          label="Trim"
          icon={<Scissors />}
          active={trimOpen && hasClip}
          disabled={!hasClip}
          onClick={() => setTrimOpen((open) => !open)}
        />
        <Tool
          label="Slow-mo"
          icon={<Timer />}
          active={Boolean(clip?.slow_mo)}
          disabled={!hasClip}
          onClick={onToggleSlowMo}
        />
        <Tool
          label="Trail"
          icon={<Spline />}
          active={edit.overlays.trail}
          onClick={() => onSetTrail(!edit.overlays.trail)}
        />
        <Tool
          label="Text"
          icon={<Type />}
          active={Boolean(caption)}
          disabled={!hasClip}
          onClick={() => setCaptionOpen(true)}
        />
        <Tool
          label={edit.format}
          ariaLabel={`Format ${edit.format}`}
          icon={<RectangleVertical />}
          onClick={onToggleFormat}
        />
        <Tool
          label="Remove"
          ariaLabel={`Remove ${clipLabel} from the reel`}
          icon={<Trash2 />}
          disabled={!hasClip}
          onClick={onRemove}
        />
      </div>

      {hasClip && (
        <CaptionDialog
          key={`${clip.trim_start}-${captionOpen}`}
          open={captionOpen}
          onOpenChange={setCaptionOpen}
          clipLabel={clipLabel}
          initial={caption ?? ""}
          onSave={onSetCaption}
        />
      )}
    </>
  )
}

/** A tool: 72×64, icon over label; active = green tint + ring (DESIGN.md). */
function Tool({
  label,
  ariaLabel,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  ariaLabel?: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-16 w-[72px] shrink-0 flex-col items-center justify-center gap-[5px] rounded-[14px] text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-[22px]",
        active
          ? "bg-success-soft text-success-text ring-[1.5px] ring-chapter ring-inset"
          : "bg-card text-foreground hover:bg-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** "Start 0:41.2 [−] [+]": the Trim tool's precise controls, 0.1 s per tap. */
function Nudge({
  label,
  value,
  onNudge,
}: {
  label: string
  value: number
  onNudge: (delta: number) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="pr-1 text-xs font-bold text-muted-foreground">
        {label}
      </span>
      <span className="w-12 text-[13px] font-extrabold tabular-nums">
        {formatTenths(value)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${label} 0.1 s earlier`}
        onClick={() => onNudge(-TRIM_SNAP)}
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${label} 0.1 s later`}
        onClick={() => onNudge(TRIM_SNAP)}
      >
        <Plus />
      </Button>
    </div>
  )
}

/** Text tool: one caption per clip, up to 80 characters (empty removes it). */
function CaptionDialog({
  open,
  onOpenChange,
  clipLabel,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clipLabel: string
  initial: string
  onSave: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSave(text)
            onOpenChange(false)
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Text on {clipLabel}</DialogTitle>
            <DialogDescription>
              Shown at the bottom of the video while this clip plays.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="caption-text">Caption</Label>
            <Input
              id="caption-text"
              value={text}
              maxLength={CAPTION_MAX}
              onChange={(event) => setText(event.target.value)}
              placeholder="Longest rally of the night"
              autoFocus
            />
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {text.length}/{CAPTION_MAX}
            </span>
          </div>
          <DialogFooter>
            {initial && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  onSave("")
                  onOpenChange(false)
                }}
              >
                Remove text
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="lg">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
