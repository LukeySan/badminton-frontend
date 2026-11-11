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

  /** The server's version we're editing on top of. */
  const baseline = useRef(reel.updated_at)
  /** What the server has (as JSON), to tell whether there's anything to save. */
  const savedJson = useRef(JSON.stringify(normalizeEdit(reel.edit)))
  const latest = useRef(edit)
  latest.current = edit
  const inFlight = useRef(false)

  const save = useCallback(async () => {
    if (inFlight.current) return // the running save checks again when it ends
    const sending = latest.current
    const json = JSON.stringify(sending)
    if (json === savedJson.current) {
      setStatus("saved")
      return
    }
    inFlight.current = true
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
      inFlight.current = false
      // Changed while saving: save again. Otherwise done.
      if (JSON.stringify(latest.current) !== json) void save()
      else setStatus("saved")
    } catch (error) {
      inFlight.current = false
      if (isStaleSave(error)) {
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
      } else {
        setStatus("error")
        toast.error("Couldn't save your highlight", {
          description: extractErrorMessage(error as Error),
        })
      }
    }
  }, [onReload, queryClient, reel.id, reel.title, reel.video_id])

  // Debounce: every change restarts the wait.
  useEffect(() => {
    if (JSON.stringify(edit) === savedJson.current) return
    setStatus((s) => (s === "saving" ? s : "unsaved"))
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [edit, save])

  // Leaving the editor (in the app): don't drop a pending change.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => () => void saveRef.current(), [])

  // Closing the tab with unsaved changes: ask first.
  useEffect(() => {
    if (status !== "unsaved" && status !== "saving") return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [status])

  return { status, retry: save }
}
