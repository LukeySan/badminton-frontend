import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, RotateCw, Share, Trash2, Upload } from "lucide-react"
import { useEffect, useState } from "react"

import type { ExportPublic, VideoPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Progress } from "@/components/ui/progress"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/useMobile"
import {
  formatBytes,
  formatDuration,
  formatShortDate,
  formatWhen,
  parseApiDate,
} from "@/lib/format"
import { isNativeApp } from "@/lib/native"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"
import {
  can1080p,
  downloadExport,
  type ExportQuality,
  exportFileQueryOptions,
  exportLinkQueryOptions,
  isExportActive,
  shareExport,
} from "./exports"
import type { ReelFormat } from "./reelEdit"
import type { ReelExports } from "./useReelExports"

/**
 * Export (the video screen header's button): a bottom sheet on phones, a side panel
 * on desktop. Top: what the export will be (length, clips, format: the reel's clips
 * in order, as Edit plays them) with the quality and the Export button. Below: "Your exports"
 * for this video, newest first, each with its progress, its preview with Share and
 * Download once done, or the reason and Try again when it failed. Closing the sheet
 * doesn't stop anything: the header's badge and a toast keep the user posted.
 */
export function ExportSheet({
  open,
  onOpenChange,
  video,
  reel,
  exports,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  video: VideoPublic
  /** The reel as it would be exported now (its clips, in order). */
  reel: {
    seconds: number
    clips: number
    format: ReelFormat
  }
  exports: ReelExports
}) {
  const mobile = useIsMobile()
  const [quality, setQuality] = useState<ExportQuality>("720p")
  const hd = can1080p(video)
  const { create, active } = exports
  const nothing = reel.clips === 0
  // An error from an earlier attempt doesn't apply once the sheet opens again
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
  useEffect(() => {
    if (open) create.reset()
  }, [open])

  const reason = nothing
    ? "Pick some rallies first: your reel is empty."
    : active
      ? "One export at a time: wait for this one to finish."
      : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        aria-describedby="export-sheet-description"
        className={cn(
          "gap-0 overflow-y-auto border-0 bg-sheet",
          mobile
            ? "max-h-[90dvh] rounded-t-[22px] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sheet"
            : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="px-4 pt-5 pb-3">
          <SheetTitle className="text-[15px] font-extrabold">
            Export highlight
          </SheetTitle>
          <SheetDescription
            id="export-sheet-description"
            className="text-[13px]"
          >
            Your reel as an MP4, to save or share.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {/* What the export will be */}
          <section
            aria-label="New export"
            className="flex flex-col gap-3 rounded-[18px] bg-background p-3"
          >
            <div className="grid grid-cols-3 gap-2">
              <Fact label="Length" value={formatDuration(reel.seconds)} />
              <Fact label="Clips" value={String(reel.clips)} />
              <Fact label="Format" value={reel.format} />
            </div>
            <p className="text-xs leading-[1.4] text-muted-foreground">
              It plays what Edit plays: your clips in their order, slow-mo at
              half speed, with your text.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-bold">Quality</span>
              <ToggleGroup
                type="single"
                spacing={1}
                value={quality}
                onValueChange={(next) =>
                  next && setQuality(next as ExportQuality)
                }
                aria-label="Quality"
              >
                {(["720p", "1080p"] as const).map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    disabled={value === "1080p" && !hd}
                    className={cn(
                      "relative h-[30px] rounded-full px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
                      "data-[state=off]:border data-[state=off]:bg-transparent data-[state=off]:font-semibold data-[state=off]:text-muted-foreground",
                      "data-[state=on]:bg-foreground data-[state=on]:font-extrabold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
                    )}
                  >
                    {value}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {!hd && (
                <span className="min-w-0 text-[11px] leading-tight text-muted-foreground">
                  1080p needs a 1080p recording
                </span>
              )}
            </div>
            <LoadingButton
              size="lg"
              loading={create.isPending}
              disabled={Boolean(reason)}
              aria-describedby={reason ? "export-reason" : undefined}
              onClick={() => create.mutate(quality)}
              className="w-full font-extrabold"
            >
              {!create.isPending && <Upload />}
              Export
            </LoadingButton>
            {reason && (
              <p
                id="export-reason"
                className="-mt-1 text-center text-xs text-muted-foreground"
              >
                {reason}
              </p>
            )}
            {create.isError && (
              <p role="alert" className="-mt-1 text-xs text-highlight-text">
                {extractErrorMessage(create.error)}
              </p>
            )}
          </section>

          {exports.exports.length > 0 && (
            <section
              aria-labelledby="your-exports"
              className="flex flex-col gap-2"
            >
              <h3 id="your-exports" className="text-[15px] font-extrabold">
                Your exports
              </h3>
              <ul aria-label="Your exports" className="flex flex-col gap-2">
                {exports.exports.map((item, index) => (
                  <li key={item.id}>
                    <ExportItem
                      item={item}
                      // The newest finished one shows its preview right away
                      previewFirst={
                        item.status === "done" &&
                        exports.exports.findIndex(
                          (e) => e.status === "done",
                        ) === index
                      }
                      exports={exports}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {exports.list.isError && (
            <p role="alert" className="text-xs text-highlight-text">
              Couldn't load your exports:{" "}
              {extractErrorMessage(exports.list.error)}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * One box of the facts row ("Length 0:24"), like the player's stat strip. On the
 * sheet the sections are `bg-background` and these `bg-card`: --sheet and --card
 * are both white in the light theme.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-card px-2.5 py-1.5">
      <span className="truncate text-[11px] font-bold text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-extrabold tabular-nums">{value}</span>
    </div>
  )
}

function ExportItem({
  item,
  previewFirst,
  exports,
}: {
  item: ExportPublic
  previewFirst: boolean
  exports: ReelExports
}) {
  const expired = parseApiDate(item.expires_at).getTime() <= Date.now()
  const percent = Math.round(item.progress * 100)
  const name = `${formatDuration(item.duration)} · ${item.quality} · ${item.format}`
  return (
    <article
      aria-label={`Export ${name}`}
      data-status={item.status}
      className="flex flex-col gap-2 rounded-[14px] bg-background p-3"
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-bold tabular-nums">{name}</span>
          {/* The edit it shows: changes made since don't change it */}
          <span className="text-xs text-muted-foreground">
            Exported from your edit at {formatWhen(item.created_at)}
          </span>
        </div>
        <DeleteExport item={item} exports={exports} />
      </div>

      {isExportActive(item) ? (
        <div className="flex flex-col gap-1.5">
          <Progress value={percent} aria-label="Export progress" />
          <p className="text-xs tabular-nums" aria-live="polite">
            {item.status === "queued"
              ? "Waiting to start…"
              : `Exporting… ${percent}%`}
            <span className="text-muted-foreground">
              {" "}
              · You can close this and keep editing.
            </span>
          </p>
        </div>
      ) : item.status === "failed" ? (
        <FailedExport item={item} exports={exports} />
      ) : expired ? (
        <p className="text-xs text-muted-foreground">
          Expired: the file was deleted after 7 days.
        </p>
      ) : (
        <DoneExport item={item} previewFirst={previewFirst} />
      )}
    </article>
  )
}

function DoneExport({
  item,
  previewFirst,
}: {
  item: ExportPublic
  previewFirst: boolean
}) {
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState(previewFirst)
  const link = useQuery(exportLinkQueryOptions(item.id))
  // Read the file ahead for Share (see exportFileQueryOptions), where it can help.
  // Not in the app: it shares a native download (shareExport).
  const canShareFiles =
    !isNativeApp &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function"
  useQuery({
    ...exportFileQueryOptions(item.id, link.data?.url),
    enabled: Boolean(link.data?.url) && preview && canShareFiles,
  })
  const [busy, setBusy] = useState<"share" | "download">()
  const [actionError, setActionError] = useState<string>()
  const portrait = item.height > item.width

  /** Share and Download both use the file (read once, then cached). */
  const run = (kind: "share" | "download") => async () => {
    const ready = link.data
    if (!ready || busy) return
    const getFile = () =>
      queryClient.fetchQuery(exportFileQueryOptions(item.id, ready.url))
    setBusy(kind)
    setActionError(undefined)
    try {
      if (kind === "share")
        await shareExport({
          getFile,
          url: ready.url,
          filename: ready.filename,
          title: item.title,
        })
      else downloadExport(await getFile(), ready.filename)
    } catch (error) {
      setActionError(extractErrorMessage(error as Error))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {preview ? (
        link.data ? (
          // A real file: the browser's own controls (and full screen) are fine here.
          // biome-ignore lint/a11y/useMediaCaption: match footage without speech; the reel's captions are burned into the file
          <video
            data-testid="export-preview"
            src={link.data.url}
            controls
            playsInline
            preload="metadata"
            className={cn(
              "w-full rounded-[12px] bg-letterbox",
              portrait
                ? "mx-auto aspect-[9/16] max-h-[50dvh] w-auto"
                : "aspect-video",
            )}
          />
        ) : (
          <div
            className={cn(
              "w-full animate-pulse rounded-[12px] bg-court",
              portrait
                ? "mx-auto aspect-[9/16] max-h-[50dvh] w-auto"
                : "aspect-video",
            )}
          />
        )
      ) : (
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="self-start text-xs font-bold text-success-text underline underline-offset-2"
        >
          Preview
        </button>
      )}
      {/* The app has one button: its share sheet has Save Video (shareExport) */}
      <div className={cn("grid gap-2", !isNativeApp && "grid-cols-2")}>
        <LoadingButton
          size="lg"
          loading={busy === "share"}
          disabled={!link.data || Boolean(busy)}
          onClick={run("share")}
          className="font-extrabold"
        >
          {busy !== "share" && <Share />}
          {isNativeApp ? "Save or share" : "Share"}
        </LoadingButton>
        {!isNativeApp && (
          <LoadingButton
            size="lg"
            variant="secondary"
            loading={busy === "download"}
            disabled={!link.data || Boolean(busy)}
            onClick={run("download")}
            className="font-extrabold"
          >
            {busy !== "download" && <Download />}
            Download
          </LoadingButton>
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Available until {formatShortDate(item.expires_at)}
        {item.size_bytes != null && ` · ${formatBytes(item.size_bytes)}`}
      </p>
      {(link.isError || actionError) && (
        <p role="alert" className="text-xs text-highlight-text">
          {actionError ?? extractErrorMessage(link.error as Error)}
        </p>
      )}
    </div>
  )
}

function FailedExport({
  item,
  exports,
}: {
  item: ExportPublic
  exports: ReelExports
}) {
  const { retry } = exports
  const mine = retry.variables === item.id
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-bold text-highlight-text">
        Failed: {item.failure_reason ?? "Something went wrong"}
      </p>
      <LoadingButton
        variant="outline"
        size="lg"
        loading={retry.isPending && mine}
        disabled={retry.isPending || Boolean(exports.active)}
        onClick={() => retry.mutate(item.id)}
        className="font-extrabold"
      >
        {!(retry.isPending && mine) && <RotateCw />}
        Try again
      </LoadingButton>
      {retry.isError && mine && (
        <p role="alert" className="text-xs text-highlight-text">
          {extractErrorMessage(retry.error)}
        </p>
      )}
    </div>
  )
}

/** Trash, then "Delete" to confirm (the file can't be made again once edited). */
function DeleteExport({
  item,
  exports,
}: {
  item: ExportPublic
  exports: ReelExports
}) {
  const [confirming, setConfirming] = useState(false)
  const { remove } = exports
  const busy = remove.isPending && remove.variables === item.id
  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  return confirming ? (
    <LoadingButton
      size="sm"
      variant="destructive"
      loading={busy}
      onClick={() => remove.mutate(item.id)}
      aria-label="Confirm: delete this export"
      className="h-9 font-extrabold"
    >
      Delete
    </LoadingButton>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Delete this export"
      onClick={() => setConfirming(true)}
      className="size-11 shrink-0 rounded-md text-muted-foreground"
    >
      <Trash2 className="size-[18px]" />
    </Button>
  )
}
