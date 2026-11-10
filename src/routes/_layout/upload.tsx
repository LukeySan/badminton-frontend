import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  useBlocker,
  useNavigate,
} from "@tanstack/react-router"
import { AxiosError, isCancel } from "axios"
import { Film, Upload } from "lucide-react"
import { type DragEvent, useEffect, useRef, useState } from "react"

import { VideosService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Progress } from "@/components/ui/progress"
import {
  invalidateVideoLists,
  videoQueryOptions,
} from "@/components/Videos/queries"
import { RecordingTips } from "@/components/Videos/RecordingTips"
import {
  checkVideoFile,
  LIMITS_TEXT,
  type UploadProblem,
  uploadErrorProblem,
} from "@/components/Videos/uploadLimits"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout/upload")({
  component: UploadPage,
  head: () => ({
    meta: [
      {
        title: "Upload - Rally Analyzer",
      },
    ],
  }),
})

// Only a hint for the file picker. The backend decides what it accepts (415 otherwise)
// and that message is shown as-is.
const ACCEPT = "video/*,.mp4,.mov,.m4v,.mkv,.webm"

function UploadPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const controller = new AbortController()
      abortRef.current = controller
      setProgress(0)
      const { data } = await VideosService.uploadVideo({
        body: { file },
        signal: controller.signal,
        // Axios reports bytes sent; the generated client passes this option through.
        onUploadProgress: (event) => {
          if (event.total) setProgress(event.loaded / event.total)
        },
      })
      return data
    },
    onSuccess: (video) => {
      // Seed the cache so the next page shows the video without another request,
      // and mark the list stale so it includes the new video.
      queryClient.setQueryData(videoQueryOptions(video.id).queryKey, video)
      invalidateVideoLists(queryClient)
      navigate({
        to: "/videos/$id/court",
        params: { id: video.id },
        ignoreBlocker: true,
      })
    },
  })

  // Leaving the page cancels the upload, so ask first (in-app links and tab close).
  useBlocker({
    shouldBlockFn: () =>
      !window.confirm("Your upload will be canceled. Leave this page?"),
    enableBeforeUnload: upload.isPending,
    disabled: !upload.isPending,
  })

  // Abort the request if the page goes away mid-upload.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Size and length are checked in the browser first, so a too-big video is refused
  // in a moment instead of after a long upload.
  const [precheck, setPrecheck] = useState<
    { checking: true } | { checking: false; problem: UploadProblem | null }
  >({ checking: false, problem: null })
  const latestFile = useRef<File | null>(null)

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen || upload.isPending) return
    setFile(chosen)
    upload.reset()
    latestFile.current = chosen
    setPrecheck({ checking: true })
    const problem = await checkVideoFile(chosen)
    // Ignore the answer if another file was chosen meanwhile.
    if (latestFile.current === chosen) setPrecheck({ checking: false, problem })
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0])
  }

  const canceled = upload.isError && isCancel(upload.error)
  const serverProblem =
    upload.isError && !canceled ? uploadErrorProblem(upload.error) : null
  const problem = (!precheck.checking && precheck.problem) || serverProblem
  // A refused file fails the same way again; network and server errors may not.
  const status =
    upload.error instanceof AxiosError
      ? upload.error.response?.status
      : undefined
  const canRetry = status === undefined || status >= 500
  // All bytes sent, but the server is still saving and checking the file.
  const checking = upload.isPending && progress >= 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">
          Upload a match
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Next you'll mark the court, then we find the rallies.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <label
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-card px-4 py-10 text-center transition-colors hover:bg-secondary dark:bg-transparent dark:hover:bg-card",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              dragging && "border-primary bg-success-soft dark:bg-success-soft",
              upload.isPending && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={upload.isPending}
              data-testid="video-file-input"
              onChange={(event) => {
                chooseFile(event.target.files?.[0])
                event.target.value = "" // so choosing the same file again still fires
              }}
            />
            <div className="flex size-12 items-center justify-center rounded-[14px] bg-success-soft text-success-text">
              <Film className="size-6" />
            </div>
            <div>
              <p className="text-[15px] font-extrabold">
                {file ? "Choose a different video" : "Choose a video"}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                <span className="hidden sm:inline">or drop it here · </span>
                MP4, MOV, M4V, MKV or WebM · {LIMITS_TEXT}
              </p>
            </div>
          </label>

          {file && (
            <div className="flex flex-col gap-4 rounded-xl bg-card p-4">
              <div className="flex items-center gap-3">
                <Film className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{file.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(file.size)}
                  </p>
                </div>
              </div>

              {upload.isPending && (
                <div className="flex flex-col gap-2" aria-live="polite">
                  <Progress
                    value={progress * 100}
                    aria-label="Upload progress"
                  />
                  <p className="text-[13px] text-muted-foreground tabular-nums">
                    {checking
                      ? "Checking the video…"
                      : `${Math.round(progress * 100)}% · ${formatBytes(progress * file.size)} of ${formatBytes(file.size)}`}
                  </p>
                </div>
              )}

              {problem && (
                <Alert variant="destructive">
                  <AlertTitle>{problem.title}</AlertTitle>
                  <AlertDescription>
                    <p>{problem.message}</p>
                    {problem.tip && (
                      <p className="text-foreground">{problem.tip}</p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {canceled && (
                <p className="text-[13px] text-muted-foreground">
                  Upload canceled.
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {upload.isPending ? (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => abortRef.current?.abort()}
                    disabled={checking}
                  >
                    Cancel
                  </Button>
                ) : (
                  !(precheck.checking === false && precheck.problem) &&
                  (canRetry || !upload.isError) && (
                    <LoadingButton
                      size="lg"
                      loading={precheck.checking}
                      onClick={() => upload.mutate(file)}
                    >
                      {!precheck.checking && <Upload />}
                      {upload.isError && !canceled ? "Try again" : "Upload"}
                    </LoadingButton>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        <RecordingTips />
      </div>
    </div>
  )
}
