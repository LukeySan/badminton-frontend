import { useQueryClient } from "@tanstack/react-query"
import { AxiosError } from "axios"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { type ReelPublic, ReelsService } from "@/client"
import { extractErrorMessage } from "@/utils"
import { videoReelQueryOptions } from "./queries"
import { type Edit, normalizeEdit } from "./reelEdit"

/** Wait this long after the last change before saving (edits come in bursts). */
export const AUTOSAVE_DELAY_MS = 800

export type SaveStatus = "saved" | "unsaved" | "saving" | "error"

const isStaleSave = (error: unknown) =>
  error instanceof AxiosError &&
  error.response?.status === 409 &&
  error.response.data?.code === "reel_changed"

/**
 * Saves the video's reel (PUT /videos/{id}/reel) a moment after the edit list stops
 * changing. A video has no reel until the first change (a pick, a cut, a setting):
 * the empty edit list counts as saved, so just watching never creates one, and the
 * first save (updated_at: null) creates it.
 *
 * One save at a time; edits made during a save go out right after it. Each save
 * sends the `updated_at` it started from, so a newer save from another tab or device
 * is never overwritten: the backend answers 409 ("reel_changed"), and then the latest
 * version is loaded (`onReload`) and the user is told their last change didn't make it.
 *
 * Rally fixes change the reel on the server too, so the editor can also: `flush` (save
 * now and wait), `hold` (no saves while a fix runs), `adopt` (the server's reel after
 * a fix is what we have) and `rebase` (the server's reel changed; save ours over it).
 */
export function useReelAutosave({
  videoId,
  title,
  reel,
  edit,
  onReload,
}: {
  videoId: string
  /** For a new reel; an existing one keeps its own. */
  title: string
  reel: ReelPublic | null
  edit: Edit
  onReload: (edit: Edit) => void
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SaveStatus>("saved")
  /** The video has a reel on the server (shown as "Saved" in the header). */
  const [exists, setExists] = useState(reel !== null)
  /** Bumped to re-arm the debounce without an edit (after rebase / hold). */
  const [tick, setTick] = useState(0)

  /** The server's version we're editing on top of (null: no reel yet). */
  const baseline = useRef<string | null>(reel?.updated_at ?? null)
  const reelTitle = useRef(reel?.title ?? title)
  /** What the server has (as JSON); null = unknown, so anything gets saved. */
  const savedJson = useRef<string | null>(
    JSON.stringify(normalizeEdit(reel?.edit)),
  )
  const latest = useRef(edit)
  latest.current = edit
  const running = useRef<Promise<void> | null>(null)
  const held = useRef(false)

  /** Record what the server has now. */
  const remember = useCallback(
    (fresh: ReelPublic | null) => {
      baseline.current = fresh?.updated_at ?? null
      if (fresh) reelTitle.current = fresh.title
      savedJson.current = JSON.stringify(normalizeEdit(fresh?.edit))
      setExists(fresh !== null)
      queryClient.setQueryData(videoReelQueryOptions(videoId).queryKey, fresh)
    },
    [queryClient, videoId],
  )

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
          const { data } = await ReelsService.saveVideoReel({
            path: { id: videoId },
            body: {
              title: reelTitle.current,
              edit: sending,
              updated_at: baseline.current,
            },
          })
          remember(data)
          savedJson.current = json
        } catch (error) {
          if (!isStaleSave(error)) {
            setStatus("error")
            toast.error("Couldn't save your reel", {
              description: extractErrorMessage(error as Error),
            })
            throw error
          }
          const fresh = await queryClient.fetchQuery({
            ...videoReelQueryOptions(videoId),
            staleTime: 0,
          })
          remember(fresh)
          onReload(normalizeEdit(fresh?.edit))
          setStatus("saved")
          toast.warning("Your reel was changed somewhere else", {
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
  }, [onReload, queryClient, remember, videoId])

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

  // Leaving the screen (in the app): don't drop a pending change.
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
      throw new Error("Your reel isn't saved yet. Try again.")
  }, [save])

  /** No saves while a rally fix runs (it changes the reel on the server). */
  const hold = useCallback((on: boolean) => {
    held.current = on
    if (!on) setTick((t) => t + 1)
  }, [])

  /** The server's reel after a fix: what we have now. */
  const adopt = useCallback(
    (fresh: ReelPublic | null) => remember(fresh),
    [remember],
  )

  /** The server's reel changed (to `updatedAt`) in a way we'll overwrite: save ours. */
  const rebase = useCallback((updatedAt: string) => {
    baseline.current = updatedAt
    savedJson.current = null
    setTick((t) => t + 1)
  }, [])

  return {
    status,
    exists,
    retry: () => void save().catch(() => {}),
    flush,
    hold,
    adopt,
    rebase,
  }
}
