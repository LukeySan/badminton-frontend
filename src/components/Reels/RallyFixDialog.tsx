import { LocateFixed } from "lucide-react"
import { useEffect, useState } from "react"

import type { RallyPublic } from "@/client"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { formatTenths } from "@/lib/format"
import { extractErrorMessage } from "@/utils"

/** Shortest rally (or part of a split) the backend accepts. */
const MIN_RALLY = 0.1

/** Which fix the dialog is for (null: closed). */
export type FixRequest =
  | { kind: "edit"; rally: RallyPublic }
  | { kind: "add"; start: number; end: number }
  | { kind: "split"; rally: RallyPublic; at: number }
  | null

export type FixValues =
  | { kind: "edit"; start: number; end: number }
  | { kind: "add"; start: number; end: number }
  | { kind: "split"; at: number }

/**
 * Times for a rally fix: Fix start and end, Split into two rallies, + Missed rally.
 * At the bottom on phones, over a clear overlay, so the video above stays visible:
 * every change shows that moment (`onPreview`). The backend has the last word (no
 * overlaps, merge only neighbours): its message is shown here.
 */
export function RallyFixDialog({
  request,
  duration,
  now,
  onPreview,
  onSubmit,
  onClose,
}: {
  request: FixRequest
  duration: number
  /** The video's current time (for "at the playhead"). */
  now: () => number
  onPreview: (t: number) => void
  onSubmit: (values: FixValues) => Promise<void>
  onClose: () => void
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName="bg-transparent"
        className="max-sm:top-auto max-sm:bottom-3 max-sm:translate-y-0 max-sm:gap-3 max-sm:p-4 sm:max-w-md"
      >
        {request && (
          <FixForm
            // A new request starts from its own values
            key={JSON.stringify(request)}
            request={request}
            duration={duration}
            now={now}
            onPreview={onPreview}
            onSubmit={onSubmit}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FixForm({
  request,
  duration,
  now,
  onPreview,
  onSubmit,
  onClose,
}: {
  request: NonNullable<FixRequest>
  duration: number
  now: () => number
  onPreview: (t: number) => void
  onSubmit: (values: FixValues) => Promise<void>
  onClose: () => void
}) {
  const initial =
    request.kind === "split"
      ? { start: request.at, end: request.at }
      : request.kind === "edit"
        ? { start: request.rally.start, end: request.rally.end }
        : { start: request.start, end: request.end }
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const limit = duration > 0 ? duration : Number.POSITIVE_INFINITY
  const clamp = (t: number) =>
    Math.round(Math.min(limit, Math.max(0, t)) * 10) / 10

  // Show the first time being set
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when it opens
  useEffect(() => onPreview(initial.start), [])

  const change = (which: "start" | "end", t: number) => {
    const value = clamp(t)
    setError(undefined)
    if (which === "start") setStart(value)
    else setEnd(value)
    onPreview(value)
  }

  let invalid: string | undefined
  if (request.kind === "split") {
    const { rally } = request
    if (start - rally.start < MIN_RALLY || rally.end - start < MIN_RALLY)
      invalid = `Pick a moment inside the rally (${formatTenths(rally.start)}–${formatTenths(rally.end)}).`
  } else if (end - start < MIN_RALLY) {
    invalid = "The end must be after the start."
  }

  const title =
    request.kind === "edit"
      ? `Fix rally ${request.rally.number}`
      : request.kind === "split"
        ? `Split rally ${request.rally.number}`
        : "Add a missed rally"
  const description =
    request.kind === "add"
      ? "Adds a rally the detector missed, here in the match. It can't overlap another rally."
      : request.kind === "split"
        ? "It becomes two rallies, split at this moment."
        : "Changes this rally everywhere, including the player's chapters."

  const submit = async () => {
    if (invalid) return
    setSaving(true)
    setError(undefined)
    try {
      await onSubmit(
        request.kind === "split"
          ? { kind: "split", at: start }
          : { kind: request.kind, start, end },
      )
      onClose()
    } catch (e) {
      setError(extractErrorMessage(e as Error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-3"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {request.kind === "split" ? (
        <TimeField
          label="Split at"
          value={start}
          onChange={(t) => change("start", t)}
          now={now}
        />
      ) : (
        <>
          <TimeField
            label="Start"
            value={start}
            onChange={(t) => change("start", t)}
            now={now}
          />
          <TimeField
            label="End"
            value={end}
            onChange={(t) => change("end", t)}
            now={now}
          />
        </>
      )}
      {(error || invalid) && (
        <p role="alert" className="text-sm font-bold text-highlight-text">
          {error ?? invalid}
        </p>
      )}
      <DialogFooter className="max-sm:flex-row max-sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="lg">
            Cancel
          </Button>
        </DialogClose>
        <LoadingButton
          type="submit"
          size="lg"
          loading={saving}
          disabled={Boolean(invalid)}
        >
          {request.kind === "split"
            ? "Split"
            : request.kind === "add"
              ? "Add rally"
              : "Save"}
        </LoadingButton>
      </DialogFooter>
    </form>
  )
}

/** "Start 0:06.8" with −1 s, −0.1, at the playhead, +0.1, +1 s (44 px targets). */
function TimeField({
  label,
  value,
  onChange,
  now,
}: {
  label: string
  value: number
  onChange: (t: number) => void
  now: () => number
}) {
  const steps: [string, string, number][] = [
    ["−1 s", "1 s earlier", -1],
    ["−0.1", "0.1 s earlier", -0.1],
  ]
  const later: [string, string, number][] = [
    ["+0.1", "0.1 s later", 0.1],
    ["+1 s", "1 s later", 1],
  ]
  const button = ([text, aria, delta]: [string, string, number]) => (
    <Button
      key={text}
      type="button"
      variant="secondary"
      className="h-11 px-0 text-[13px] font-extrabold tabular-nums"
      aria-label={`${label} ${aria}`}
      onClick={() => onChange(value + delta)}
    >
      {text}
    </Button>
  )
  return (
    <fieldset className="m-0 grid gap-1.5 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-baseline justify-between">
        <span aria-hidden="true" className="text-sm font-bold">
          {label}
        </span>
        <output
          aria-label={label}
          className="text-[17px] font-extrabold tabular-nums"
        >
          {formatTenths(value)}
        </output>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {steps.map(button)}
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-0"
          aria-label={`${label} at the playhead`}
          title="At the playhead"
          onClick={() => onChange(now())}
        >
          <LocateFixed className="size-[18px]" />
        </Button>
        {later.map(button)}
      </div>
    </fieldset>
  )
}
