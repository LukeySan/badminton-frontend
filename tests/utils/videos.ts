import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Talks to the backend directly to set up and clean up test videos (faster and
// steadier than uploading through the UI, which upload tests would cover).

const API = `${process.env.VITE_API_URL}/api/v1`
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
)
/** 2 s, 320×180, H.264, 9 KB: for uploads that are never played. */
export const SHORT_CLIP = path.join(FIXTURES, "short-clip.mp4")
/** 12 s, 320×180, VP8 WebM: plays in every test browser (Playwright's own Chromium
 *  has no H.264). For tests that need playback. */
export const PLAYABLE_CLIP = path.join(FIXTURES, "rally-clip.webm")

export async function apiToken(email: string, password: string) {
  const response = await fetch(`${API}/login/access-token`, {
    method: "POST",
    body: new URLSearchParams({ username: email, password }),
  })
  if (!response.ok) throw new Error(`Login failed: ${response.status}`)
  return ((await response.json()) as { access_token: string }).access_token
}

/** Uploads the fixture clip under `filename`; returns the new video's id. */
export async function uploadVideo(
  token: string,
  filename: string,
  fixture = SHORT_CLIP,
) {
  const body = new FormData()
  const type = fixture.endsWith(".webm") ? "video/webm" : "video/mp4"
  body.append("file", new Blob([fs.readFileSync(fixture)], { type }), filename)
  const response = await fetch(`${API}/videos/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
  return ((await response.json()) as { id: string }).id
}

/** HTTP status of GET /videos/{id} (404 once deleted). */
export async function videoStatus(token: string, id: string) {
  const response = await fetch(`${API}/videos/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.status
}

/** Cleanup: deletes the video if it still exists. */
export async function deleteVideo(token: string, id: string) {
  await fetch(`${API}/videos/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** A reel on a video (empty edit list unless given); returns its id. */
export async function createReel(
  token: string,
  videoId: string,
  title = "Test highlight",
  edit: Record<string, unknown> = {},
) {
  const response = await fetch(`${API}/videos/${videoId}/reels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, edit }),
  })
  if (!response.ok) throw new Error(`Create reel failed: ${response.status}`)
  return ((await response.json()) as { id: string }).id
}

export type TestPiece = { start: number; end: number; slow_mo?: boolean }

/** GET /reels/{id} as JSON (edit list v2: clips are rallies cut into pieces). */
export async function readReel(token: string, reelId: string) {
  const response = await fetch(`${API}/reels/${reelId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await response.json()) as {
    title: string
    updated_at: string
    edit: Record<string, unknown> & {
      format?: string
      view?: string
      lead_in: number
      lead_out: number
      clips: { rally_id: number; pieces: TestPiece[] }[]
      restored_gaps: { start: number; end: number }[]
      overlays: { captions: { start: number; end: number; text: string }[] }
    }
  }
}

/** Saves a reel the way another tab or device would (full replace). */
export async function saveReelElsewhere(
  token: string,
  reelId: string,
  edit: Record<string, unknown>,
) {
  const current = await readReel(token, reelId)
  const response = await fetch(`${API}/reels/${reelId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: current.title,
      edit: { ...current.edit, ...edit },
      updated_at: current.updated_at,
    }),
  })
  if (!response.ok) throw new Error(`Save reel failed: ${response.status}`)
}

/**
 * Seven rallies on the 12 s PLAYABLE_CLIP (start, end in seconds). Lengths 0.8, 0.3,
 * 1.2, 0.3, 1.8, 0.4, 1.0: the five longest are rallies 5, 3, 7, 1, 6.
 */
export const SEEDED_RALLIES: [number, number][] = [
  [0.5, 1.3],
  [2.3, 2.6],
  [3.4, 4.6],
  [5.6, 5.9],
  [6.8, 8.6],
  [9.4, 9.8],
  [10.6, 11.6],
]

/**
 * Marks a video analyzed with real rallies through the backend's development-only
 * fixture, the same way the worker finishes a video. `thumbnails`: also make the
 * thumbnail strip from the uploaded file (ffmpeg, ~1 s).
 */
export async function seedAnalysis(
  videoId: string,
  rallies: [number, number][] = SEEDED_RALLIES,
  { thumbnails = false }: { thumbnails?: boolean } = {},
) {
  const response = await fetch(`${API}/private/videos/${videoId}/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rallies, thumbnails }),
  })
  if (!response.ok) throw new Error(`Seeding failed: ${response.status}`)
}

/** The video's rallies as the API returns them (ids in match order). */
export async function readRallies(token: string, videoId: string) {
  const response = await fetch(`${API}/videos/${videoId}/rallies`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (
    (await response.json()) as {
      data: { id: number; number: number; start: number; end: number }[]
    }
  ).data
}

/** [start, end] of each rally, in match order (for comparing after a fix). */
export const rallyBounds = async (token: string, videoId: string) =>
  (await readRallies(token, videoId)).map((r) => [r.start, r.end])
