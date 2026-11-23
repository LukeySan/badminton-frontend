import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { type ExportPublic, type ExportsPublic, ExportsService } from "@/client"
import {
  type ExportQuality,
  isExportActive,
  videoExportsQueryOptions,
} from "./exports"

/**
 * The video's exports for the video screen: the list (polled while one is queued or
 * rendering, also with the sheet closed, for the Export button's badge), a toast when
 * one finishes or fails, and start / try again / delete.
 */
export function useReelExports({
  videoId,
  beforeExport,
  quiet,
  onShow,
}: {
  videoId: string
  /** Save the reel first: the server exports what it has, not what's on screen. */
  beforeExport: () => Promise<void>
  /** The sheet is open (it shows the news itself): no toasts. */
  quiet: boolean
  /** The toasts' "Show" action. */
  onShow: () => void
}) {
  const queryClient = useQueryClient()
  const options = videoExportsQueryOptions(videoId)
  const list = useQuery(options)
  const exports = list.data?.data ?? []
  const active = exports.find(isExportActive)

  const setList = (update: (data: ExportPublic[]) => ExportPublic[]) =>
    queryClient.setQueryData<ExportsPublic>(options.queryKey, (old) => {
      const data = update(old?.data ?? [])
      return { data, count: data.length }
    })
  const replace = (fresh: ExportPublic) =>
    setList((data) => data.map((e) => (e.id === fresh.id ? fresh : e)))

  // Toast when an export we saw queued or rendering finishes (not for old ones)
  const latest = useRef({ quiet, onShow })
  latest.current = { quiet, onShow }
  const statuses = useRef<Map<string, ExportPublic["status"]>>(undefined)
  useEffect(() => {
    if (!list.data) return
    const before = statuses.current
    statuses.current = new Map(list.data.data.map((e) => [e.id, e.status]))
    if (!before || latest.current.quiet) return
    const show = { label: "Show", onClick: () => latest.current.onShow() }
    for (const e of list.data.data) {
      const was = before.get(e.id)
      if (!was || !isExportActive({ status: was })) continue
      if (e.status === "done")
        toast.success("Your highlight is ready", {
          description: "Share it or save it from Export.",
          action: show,
        })
      else if (e.status === "failed")
        toast.error("The export failed", {
          description: e.failure_reason ?? undefined,
          action: show,
        })
    }
  }, [list.data])

  const create = useMutation({
    mutationFn: async (quality: ExportQuality) => {
      await beforeExport()
      return (
        await ExportsService.createExport({
          path: { id: videoId },
          body: { quality },
        })
      ).data
    },
    onSuccess: (created) => {
      setList((data) => [created, ...data.filter((e) => e.id !== created.id)])
      void queryClient.invalidateQueries({ queryKey: options.queryKey })
    },
    // 409 (one is already running elsewhere) or 429: the list may be out of date
    onError: () =>
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
  })

  const retry = useMutation({
    mutationFn: async (exportId: string) =>
      (await ExportsService.retryExport({ path: { export_id: exportId } }))
        .data,
    onSuccess: replace,
    onError: () =>
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
  })

  const remove = useMutation({
    mutationFn: async (exportId: string) => {
      await ExportsService.deleteExport({ path: { export_id: exportId } })
      return exportId
    },
    onSuccess: (exportId) => {
      setList((data) => data.filter((e) => e.id !== exportId))
      queryClient.removeQueries({ queryKey: ["exports", exportId] })
      toast.success("Export deleted")
    },
    onError: () =>
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
  })

  return { list, exports, active, create, retry, remove }
}

export type ReelExports = ReturnType<typeof useReelExports>
