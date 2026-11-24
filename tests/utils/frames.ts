import { spawnSync } from "node:child_process"

// Frames of exported MP4s, for checking where the export drew things. The test's
// browsers can't decode them (Playwright's Chromium has no H.264), so ffmpeg does,
// on the machine running the tests (CI installs it; the WebKit Docker run uses an
// image with it, see scripts/test-webkit-docker.sh).

export const hasFfmpeg = () =>
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0

export type Frame = { width: number; height: number; rgb: Buffer }

/** The frame shown at `t` seconds, as RGB bytes at the video's own size. */
export function grabFrame(
  file: string,
  t: number,
  width: number,
  height: number,
): Frame {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-ss",
      String(t),
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.status !== 0)
    throw new Error(`ffmpeg failed: ${result.stderr.toString()}`)
  if (result.stdout.length !== width * height * 3)
    throw new Error(
      `Expected a ${width}×${height} frame, got ${result.stdout.length} bytes`,
    )
  return { width, height, rgb: result.stdout }
}

/**
 * Where two frames of the same size differ a lot (by more than `threshold` in any
 * channel), as a box in fractions of the frame: the rows and columns where at least
 * half as many pixels changed as in the most changed row / column (so encoder noise
 * and a few stray pixels don't count). Undefined when nothing changed.
 */
export function changedBox(a: Frame, b: Frame, threshold = 60) {
  const { width, height } = a
  const rows = new Array<number>(height).fill(0)
  const cols = new Array<number>(width).fill(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const d = Math.max(
        Math.abs(a.rgb[i] - b.rgb[i]),
        Math.abs(a.rgb[i + 1] - b.rgb[i + 1]),
        Math.abs(a.rgb[i + 2] - b.rgb[i + 2]),
      )
      if (d > threshold) {
        rows[y]++
        cols[x]++
      }
    }
  }
  const span = (counts: number[]) => {
    const max = Math.max(...counts)
    if (max === 0) return undefined
    const first = counts.findIndex((c) => c >= max / 2)
    const last =
      counts.length - 1 - [...counts].reverse().findIndex((c) => c >= max / 2)
    return [first, last + 1] as const
  }
  const ys = span(rows)
  const xs = span(cols)
  if (!xs || !ys) return undefined
  return {
    left: xs[0] / width,
    right: xs[1] / width,
    top: ys[0] / height,
    bottom: ys[1] / height,
  }
}
