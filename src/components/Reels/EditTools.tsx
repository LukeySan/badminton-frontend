import { RectangleVertical, Scissors, Timer, Trash2, Type } from "lucide-react"
import { type ReactNode, useState } from "react"

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
import { CAPTION_MAX, type Clip, type ReelFormat } from "./reelEdit"

/**
 * The tool row under the timeline, pinned to the bottom of the screen. Every change
 * is a callback that goes through the reducer. (Moving a clip is on the timeline:
 * press and hold it.)
 */
export function EditTools({
  format,
  clip,
  name,
  canCut,
  caption,
  onCut,
  onDelete,
  onToggleSlowMo,
  onSetCaption,
  onToggleFormat,
}: {
  format: ReelFormat
  /** The selected clip (undefined: nothing selected). */
  clip: Clip | undefined
  /** "clip 3" */
  name: string
  /** The playhead is inside the selected clip, at least 0.3 s from its edges. */
  canCut: boolean
  caption: string | undefined
  onCut: () => void
  onDelete: () => void
  onToggleSlowMo: () => void
  onSetCaption: (text: string) => void
  onToggleFormat: () => void
}) {
  const [captionOpen, setCaptionOpen] = useState(false)
  const hasClip = clip !== undefined

  return (
    <>
      <div
        role="toolbar"
        aria-label="Edit tools"
        // Pinned to the bottom of the screen (EditPanel's timeline takes the space above)
        className="flex shrink-0 gap-2 overflow-x-auto border-t border-track px-3 pt-1 pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <Tool
          label="Cut"
          ariaLabel={hasClip ? `Cut ${name} at the playhead` : "Cut"}
          icon={<Scissors />}
          primary
          disabled={!canCut}
          onClick={onCut}
        />
        <Tool
          label="Delete"
          ariaLabel={hasClip ? `Delete ${name}` : "Delete"}
          icon={<Trash2 />}
          disabled={!hasClip}
          onClick={onDelete}
        />
        <Tool
          label="Slow-mo"
          icon={<Timer />}
          active={Boolean(clip?.slow_mo)}
          disabled={!hasClip}
          onClick={onToggleSlowMo}
        />
        <Tool
          label="Text"
          icon={<Type />}
          active={Boolean(caption)}
          disabled={!hasClip}
          onClick={() => setCaptionOpen(true)}
        />
        <Tool
          label={format}
          ariaLabel={`Format ${format}`}
          icon={<RectangleVertical />}
          onClick={onToggleFormat}
        />
      </div>

      {hasClip && (
        <CaptionDialog
          key={`${clip.id}-${captionOpen}`}
          open={captionOpen}
          onOpenChange={setCaptionOpen}
          name={name}
          initial={caption ?? ""}
          onSave={onSetCaption}
        />
      )}
    </>
  )
}

/**
 * A tool: 68×64, icon over label. Active = green tint + ring; primary (Cut) = the
 * light fill (DESIGN.md).
 */
function Tool({
  label,
  ariaLabel,
  icon,
  active,
  primary,
  disabled,
  onClick,
}: {
  label: string
  ariaLabel?: string
  icon: ReactNode
  active?: boolean
  primary?: boolean
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
        "group flex h-16 w-[68px] shrink-0 flex-col items-center justify-center rounded-[14px] text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[22px]",
        primary
          ? // The prototype's mint tile with ink text, in both themes. Disabled (the
            // playhead at a clip's edge) it stays mint and only its content fades:
            // a grey tile read as "selected".
            "bg-tool-primary text-tool-primary-foreground ring-[1.5px] ring-tool-primary-edge ring-inset hover:brightness-95 disabled:hover:brightness-100"
          : cn(
              "disabled:opacity-40",
              active
                ? "bg-success-soft text-success-text ring-[1.5px] ring-chapter ring-inset"
                : "bg-card text-foreground hover:bg-secondary",
            ),
      )}
    >
      <span
        className={cn(
          "flex flex-col items-center gap-[5px]",
          primary && "group-disabled:opacity-40",
        )}
      >
        {icon}
        {label}
      </span>
    </button>
  )
}

/** Text tool: one caption per clip, up to 80 characters (empty removes it). */
function CaptionDialog({
  open,
  onOpenChange,
  name,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
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
            <DialogTitle>Text on {name}</DialogTitle>
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
