import {
  RectangleVertical,
  Repeat,
  Scissors,
  Timer,
  Trash2,
  Type,
} from "lucide-react"
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
import { CAPTION_MAX, type Edit, type Piece } from "./reelEdit"

/**
 * Below the timeline: what's selected, then the tools. Cut and Delete are the editing
 * model (cut at the playhead, delete the part you don't want); every change is a
 * callback that goes through the reducer. Loop only changes the preview.
 */
export function EditTools({
  edit,
  piece,
  pieceLabel,
  part,
  canCut,
  loop,
  caption,
  onCut,
  onDelete,
  onToggleSlowMo,
  onToggleLoop,
  onSetCaption,
  onToggleFormat,
}: {
  edit: Edit
  /** The selected piece (undefined: nothing selected). */
  piece: Piece | undefined
  /** "Rally 19" */
  pieceLabel: string
  /** Its place in the clip: [2, 3] = part 2 of 3. */
  part: [number, number] | undefined
  /** The playhead is inside the selected piece, not too close to its edges. */
  canCut: boolean
  loop: boolean
  caption: string | undefined
  onCut: () => void
  onDelete: () => void
  onToggleSlowMo: () => void
  onToggleLoop: () => void
  onSetCaption: (text: string) => void
  onToggleFormat: () => void
}) {
  const [captionOpen, setCaptionOpen] = useState(false)
  const hasPiece = piece !== undefined
  const name =
    part && part[1] > 1
      ? `${pieceLabel}, part ${part[0]} of ${part[1]}`
      : pieceLabel

  return (
    <>
      <p
        data-testid="selection-hint"
        className="flex min-h-[34px] shrink-0 items-center px-4 py-0.5 text-xs leading-[1.3] text-muted-foreground md:px-0"
      >
        {hasPiece ? (
          <span>
            <span className="font-extrabold text-highlight-text">{name}</span>{" "}
            selected. Cut at the playhead, then delete the part you don’t want.
          </span>
        ) : (
          <span>Tap a clip to select it.</span>
        )}
      </p>

      <div
        role="toolbar"
        aria-label="Edit tools"
        className="flex shrink-0 gap-2 overflow-x-auto border-t border-track px-3 pt-1 pb-[max(1.375rem,env(safe-area-inset-bottom))] [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <Tool
          label="Cut"
          ariaLabel={hasPiece ? `Cut ${name} at the playhead` : "Cut"}
          icon={<Scissors />}
          primary
          disabled={!canCut}
          onClick={onCut}
        />
        <Tool
          label="Delete"
          ariaLabel={hasPiece ? `Delete ${name}` : "Delete"}
          icon={<Trash2 />}
          disabled={!hasPiece}
          onClick={onDelete}
        />
        <Tool
          label="Slow-mo"
          icon={<Timer />}
          active={Boolean(piece?.slow_mo)}
          disabled={!hasPiece}
          onClick={onToggleSlowMo}
        />
        <Tool
          label="Loop"
          icon={<Repeat />}
          active={loop && hasPiece}
          disabled={!hasPiece}
          onClick={onToggleLoop}
        />
        <Tool
          label="Text"
          icon={<Type />}
          active={Boolean(caption)}
          disabled={!hasPiece}
          onClick={() => setCaptionOpen(true)}
        />
        <Tool
          label={edit.format}
          ariaLabel={`Format ${edit.format}`}
          icon={<RectangleVertical />}
          onClick={onToggleFormat}
        />
      </div>

      {hasPiece && (
        <CaptionDialog
          key={`${piece.start}-${captionOpen}`}
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
        "flex h-16 w-[68px] shrink-0 flex-col items-center justify-center gap-[5px] rounded-[14px] text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-[22px]",
        primary
          ? "bg-foreground text-background hover:bg-foreground/90"
          : active
            ? "bg-success-soft text-success-text ring-[1.5px] ring-chapter ring-inset"
            : "bg-card text-foreground hover:bg-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Text tool: one caption per piece, up to 80 characters (empty removes it). */
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
              Shown at the bottom of the video while this part plays.
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
