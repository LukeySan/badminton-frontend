import { Minus, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LEAD_STEP, MAX_LEAD } from "./reelEdit"

const seconds = (t: number) => `${Number(t.toFixed(2))} s`

/** "±1 s", or "−0.5 s +2 s" when they differ. */
const chipText = (leadIn: number, leadOut: number) =>
  leadIn === leadOut
    ? `±${seconds(leadIn)}`
    : `−${seconds(leadIn)} +${seconds(leadOut)}`

/**
 * The reel's lead-in / lead-out: how much footage each clip keeps before and after its
 * rally (the detector can be 1-2 s off). A chip in the view row; the dialog changes
 * the reel live, one undo step per tap.
 */
export function LeadSetting({
  leadIn,
  leadOut,
  onChange,
}: {
  leadIn: number
  leadOut: number
  onChange: (lead: { lead_in: number; lead_out: number }) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Lead-in ${seconds(leadIn)}, lead-out ${seconds(leadOut)}. Change`}
        title="Footage kept before and after each rally"
        className="group flex h-11 shrink-0 items-center outline-none"
      >
        <span className="flex h-7 items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] border-border px-2.5 text-xs font-extrabold tabular-nums group-hover:bg-secondary group-focus-visible:ring-2 group-focus-visible:ring-ring">
          <span className="font-bold text-muted-foreground">Lead</span>
          {chipText(leadIn, leadOut)}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* At the bottom on phones, over a clear overlay: the timeline above shows
            the clips change with every tap */}
        <DialogContent
          overlayClassName="bg-transparent"
          className="max-sm:top-auto max-sm:bottom-3 max-sm:translate-y-0 max-sm:gap-3 max-sm:p-4 sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle>Before and after each rally</DialogTitle>
            <DialogDescription>
              Detected start and end times can be 1–2 s off, so each clip keeps
              a little footage around its rally (0–3 s). Parts you cut stay cut.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Stepper
              label="Lead-in"
              hint="before the rally"
              value={leadIn}
              onChange={(lead_in) => onChange({ lead_in, lead_out: leadOut })}
            />
            <Stepper
              label="Lead-out"
              hint="after the rally"
              value={leadOut}
              onChange={(lead_out) => onChange({ lead_in: leadIn, lead_out })}
            />
          </div>
          <DialogFooter>
            <Button size="lg" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stepper({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: number
  onChange: (value: number) => void
}) {
  const id = `lead-${label.toLowerCase()}`
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={id} className="text-sm font-bold">
          {label}
        </span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${label} shorter`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - LEAD_STEP))}
      >
        <Minus />
      </Button>
      <output
        aria-labelledby={id}
        className="w-12 text-center text-[15px] font-extrabold tabular-nums"
      >
        {seconds(value)}
      </output>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${label} longer`}
        disabled={value >= MAX_LEAD}
        onClick={() => onChange(Math.min(MAX_LEAD, value + LEAD_STEP))}
      >
        <Plus />
      </Button>
    </div>
  )
}
