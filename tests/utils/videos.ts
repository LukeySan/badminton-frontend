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
