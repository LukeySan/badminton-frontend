import { AxiosError } from "axios"

import { formatBytes } from "@/lib/format"
import { extractErrorMessage } from "@/utils"

// The backend's beta limits (MAX_UPLOAD_BYTES, MAX_VIDEO_MINUTES in
// badminton-backend/backend/app/core/config.py). Repeated here only so nobody waits
// for a 2 GB upload to fail: the backend still enforces them, and if they ever differ
// its message is what the user sees.
// TODO(backend): expose the limits (e.g. GET /limits) so this copy can go.
export const MAX_UPLOAD_BYTES = 2_000_000_000 // decimal GB, as phones show sizes
export const MAX_VIDEO_MINUTES = 60

export const LIMITS_TEXT = `up to ${formatBytes(MAX_UPLOAD_BYTES)} and ${MAX_VIDEO_MINUTES} min`

export type UploadProblem = { title: string; message: string; tip?: string }

const TOO_BIG_TIP =
  "Trim it to the match, or export it at 1080p or 720p: the analysis doesn't need 4K."
const TOO_LONG_TIP = `Split it into parts of up to ${MAX_VIDEO_MINUTES} minutes.`

/**
 * Length from the file's metadata, read by the browser without uploading anything.
 * null when the browser can't tell (e.g. MKV in Safari): the backend checks anyway.
 */
export function readVideoDuration(
  file: File,
  timeoutMs = 5000,
): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)
    const done = (duration: number | null) => {
      clearTimeout(timer)
      video.removeAttribute("src")
      video.load() // release the file
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    video.preload = "metadata"
    video.muted = true
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

/** Checks a chosen file against the limits before uploading. null = looks fine. */
export async function checkVideoFile(
  file: File,
): Promise<UploadProblem | null> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      title: "This video is too big",
      message: `It's ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      tip: TOO_BIG_TIP,
    }
  }
  const seconds = await readVideoDuration(file)
  if (seconds !== null && seconds > MAX_VIDEO_MINUTES * 60) {
    return {
      title: "This video is too long",
      message: `It's ${Math.round(seconds / 60)} minutes long; the limit is ${MAX_VIDEO_MINUTES} minutes.`,
      tip: TOO_LONG_TIP,
    }
  }
  return null
}

/** The backend's refusal, with a title and a tip for the limits it enforces. */
export function uploadErrorProblem(error: Error): UploadProblem {
  const message = extractErrorMessage(error)
  const status =
    error instanceof AxiosError ? error.response?.status : undefined
  switch (status) {
    case 413:
      return { title: "This video is too big", message, tip: TOO_BIG_TIP }
    case 415:
      return {
        title: "Not a video we can use",
        message,
        tip: "Use an MP4, MOV, M4V, MKV or WebM file.",
      }
    case 422:
      return { title: "This video is too long", message, tip: TOO_LONG_TIP }
    case 400:
      return {
        title: "Couldn't read this video",
        message,
        tip: "The file may be damaged. Export it again from your phone's gallery and try that.",
      }
    default:
      return { title: "Upload failed", message }
  }
}
