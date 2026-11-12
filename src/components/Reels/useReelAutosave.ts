import { useQueryClient } from "@tanstack/react-query"
import { AxiosError } from "axios"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { type ReelPublic, ReelsService } from "@/client"
import { extractErrorMessage } from "@/utils"
import { reelQueryOptions } from "./queries"
import { type Edit, normalizeEdit } from "./reelEdit"

/** Wait this long after the last change before saving (edits come in bursts). */
export const AUTOSAVE_DELAY_MS = 800

export type SaveStatus = "saved" | "unsaved" | "saving" | "error"

const isStaleSave = (error: unknown) =>
  error instanceof AxiosError &&
  error.response?.status === 409 &&
  error.response.data?.code === "reel_changed"

/**
 * Saves the edit list a moment after it stops changing. One save at a time; edits
 * made during a save go out right after it. Each save sends the `updated_at` it
 * started from, so a newer save from another tab or device is never overwritten:
 * the backend answers 409 ("reel_changed"), and then the latest version is loaded
 * (`onReload`) and the user is told their last change didn't make it.
 *
 * Rally fixes change reels on the server too, so the editor can also: `flush` (save
 * now and wait), `hold` (no saves while a fix runs), `adopt` (the server's reel after
 * a fix is what we have) and `rebase` (the server's reel changed; save ours over it).
 */
export function useReelAutosave({
  reel,
  edit,
  onReload,
}: {
  reel: ReelPublic
  edit: Edit
  onReload: (edit: Edit) => void
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SaveStatus>("saved")
  /** Bumped to re-arm the debounce without an edit (after rebase / hold). */
  const [tick, setTick] = useState(0)

  /** The server's version we're editing on top of. */
  const baseline = useRef(reel.updated_at)
  /** What the server has (as JSON); null = unknown, so anything gets saved. */
  const savedJson = useRef<string | null>(
    JSON.stringify(normalizeEdit(reel.edit)),
  )
  const latest = useRef(edit)
  latest.current = edit
  const running = useRef<Promise<void> | null>(null)
  const held = useRef(false)

  const save = useCallback(async (): Promise<void> => {
    if (held.current) return
    // The running save checks for newer changes when it ends.
    if (running.current) return running.current
    const run = (async () => {
      while (!held.current) {
        const sending = latest.current
        const json = JSON.stringify(sending)
        if (json === savedJson.current) {
          setStatus("saved")
          return
        }
        setStatus("saving")
        try {
          const { data } = await ReelsService.updateReel({
            path: { reel_id: reel.id },
            body: {
              title: reel.title,
              edit: sending,
              updated_at: baseline.current,
            },
          })
          baseline.current = data.updated_at
          savedJson.current = json
          queryClient.setQueryData(
            reelQueryOptions(reel.video_id, reel.id).queryKey,
            data,
          )
        } catch (error) {
          if (!isStaleSave(error)) {
            setStatus("error")
            toast.error("Couldn't save your highlight", {
              description: extractErrorMessage(error as Error),
            })
            throw error
          }
          const fresh = await queryClient.fetchQuery({
            ...reelQueryOptions(reel.video_id, reel.id),
            staleTime: 0,
          })
          baseline.current = fresh.updated_at
          const freshEdit = normalizeEdit(fresh.edit)
          savedJson.current = JSON.stringify(freshEdit)
          onReload(freshEdit)
          setStatus("saved")
          toast.warning("This highlight was changed somewhere else", {
            description:
              "We loaded the latest version. Your last change wasn't saved.",
          })
          throw error
        }
      }
    })()
    running.current = run
    try {
      await run
    } finally {
      running.current = null
    }
  }, [onReload, queryClient, reel.id, reel.title, reel.video_id])

  // Debounce: every change restarts the wait.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-arms it on purpose
  useEffect(() => {
    if (JSON.stringify(edit) === savedJson.current) return
    setStatus((s) => (s === "saving" ? s : "unsaved"))
    const timer = window.setTimeout(
      () => void save().catch(() => {}),
      AUTOSAVE_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [edit, save, tick])

  // Leaving the editor (in the app): don't drop a pending change.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => () => void saveRef.current().catch(() => {}), [])

  // Closing the tab with unsaved changes: ask first.
  useEffect(() => {
    if (status !== "unsaved" && status !== "saving") return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [status])

  /** Save now and wait: afterwards the server has exactly what's on screen. */
  const flush = useCallback(async () => {
    await save()
    if (JSON.stringify(latest.current) !== savedJson.current)
      throw new Error("Your highlight isn't saved yet. Try again.")
  }, [save])

  /** No saves while a rally fix runs (it changes the reel on the server). */
  const hold = useCallback((on: boolean) => {
    held.current = on
    if (!on) setTick((t) => t + 1)
  }, [])

  /** The server's reel after a fix: what we have now. */
  const adopt = useCallback(
    (fresh: ReelPublic) => {
      baseline.current = fresh.updated_at
      savedJson.current = JSON.stringify(normalizeEdit(fresh.edit))
      queryClient.setQueryData(
        reelQueryOptions(reel.video_id, reel.id).queryKey,
        fresh,
      )
    },
    [queryClient, reel.id, reel.video_id],
  )

  /** The server's reel changed (to `updatedAt`) in a way we'll overwrite: save ours. */
  const rebase = useCallback((updatedAt: string) => {
    baseline.current = updatedAt
    savedJson.current = null
    setTick((t) => t + 1)
  }, [])

  return {
    status,
    retry: () => void save().catch(() => {}),
    flush,
    hold,
    adopt,
    rebase,
  }
}
