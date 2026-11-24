import {
  Check,
  PencilLine,
  RectangleVertical,
  Scissors,
  Timer,
  Trash2,
  Type,
} from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import type { Clip, ReelFormat } from "./reelEdit"

/**
 * The tool row under the timeline, pinned to the bottom of the screen. Every change
 * is a callback that goes through the reducer. (Moving a clip is on the timeline:
 * press and hold it.)
 *
 * Two sets: the clip tools (Cut, Delete, Slow-mo, Text, Format), and while an overlay
 * is selected its own (Edit text, Cut, Delete, Done). Selecting a clip brings the
 * clip tools back.
 */
export function EditTools({
  format,
  clip,
  name,
  canCut,
  canAddText,
  onCut,
  onDelete,
  onToggleSlowMo,
  onAddText,
  onToggleFormat,
}: {
  format: ReelFormat
  /** The selected clip (undefined: nothing selected). */
  clip: Clip | undefined
  /** "clip 3" */
  name: string
  /** The playhead is inside the selected clip, at least 0.3 s from its edges. */
  canCut: boolean
  /** Below the reel's overlay limit (the hint above says why not). */
  canAddText: boolean
  onCut: () => void
  onDelete: () => void
  onToggleSlowMo: () => void
  /** Text: a new text overlay at the playhead, typed into right away. */
  onAddText: () => void
  onToggleFormat: () => void
}) {
  const hasClip = clip !== undefined
  return (
    <ToolRow label="Edit tools">
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
        ariaLabel="Add text at the playhead"
        icon={<Type />}
        disabled={!canAddText}
        onClick={onAddText}
      />
      <Tool
        label={format}
        ariaLabel={`Format ${format}`}
        icon={<RectangleVertical />}
        onClick={onToggleFormat}
      />
    </ToolRow>
  )
}

/** The tools for the selected overlay (a text). */
export function OverlayTools({
  canCut,
  onEditText,
  onCut,
  onDelete,
  onDone,
}: {
  /** The playhead is inside the overlay, at least 0.3 s from its start and end. */
  canCut: boolean
  onEditText: () => void
  onCut: () => void
  onDelete: () => void
  onDone: () => void
}) {
  return (
    <ToolRow label="Text tools">
      <Tool label="Edit text" icon={<PencilLine />} onClick={onEditText} />
      <Tool
        label="Cut"
        ariaLabel="Cut the text at the playhead"
        icon={<Scissors />}
        primary
        disabled={!canCut}
        onClick={onCut}
      />
      <Tool
        label="Delete"
        ariaLabel="Delete the text"
        icon={<Trash2 />}
        onClick={onDelete}
      />
      <Tool label="Done" icon={<Check />} onClick={onDone} />
    </ToolRow>
  )
}

function ToolRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      // Pinned to the bottom of the screen (EditPanel's timeline takes the space above)
      className="flex shrink-0 gap-2 overflow-x-auto border-t border-track px-3 pt-1 pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
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
