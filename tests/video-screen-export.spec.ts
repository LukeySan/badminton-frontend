import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  PLAYABLE_CLIP,
  readExports,
  readRallies,
  renderExport,
  seedAnalysis,
  setExportState,
  uploadVideo,
} from "./utils/videos"

// Export: the header's Export opens a sheet (bottom sheet on phones) with what the
// export will be (always the Rallies-only result), the quality and the Export
// button; "Your exports" below with progress, the finished MP4 (preview, Share,
// Download), failures with Try again, and delete. Exports are moved along with the
// backend's development-only fixtures (state, and a real render with ffmpeg), so no
// worker is needed. A running local worker may render them first: that's fine, the
// fixtures set the state each step needs.
// Runs at phone width in Chromium, desktop WebKit and the iPhone project.

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
})

let cleanup: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

const API = `${process.env.VITE_API_URL}/api/v1`

/**
 * A user with the 12 s playable clip (320×180: no 1080p) analyzed with three rallies;
 * `reel`: a reel of rallies 1 and 2, each with 1 s around it (0-2.3 s and 3.4-6.5 s:
 * 5.4 s, "0:05").
 */
async function setUp(page: Page, { reel = true } = {}) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `match-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId) // its reel and exports go with it
  await seedAnalysis(videoId, [
    [1, 1.3],
    [4.4, 5.5],
    [9, 10],
  ])
  if (reel) {
    const rallies = await readRallies(token, videoId)
    await createReel(token, videoId, {
      version: 5,
      segments: [
        { id: "c1", start: 0, end: 2.3, rally_id: rallies[0].id },
        { id: "c2", start: 3.4, end: 6.5, rally_id: rallies[1].id },
      ],
    })
  }
  await logInUser(page, email, password)
  return { token, videoId, name }
}

/** POST /videos/{id}/reel/exports, as the sheet's Export button does. */
async function startExport(token: string, videoId: string) {
  const response = await fetch(`${API}/videos/${videoId}/reel/exports`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error(`Export failed: ${response.status}`)
  return ((await response.json()) as { id: string }).id
}

/** The header's Export button (its name carries the progress while exporting). */
const exportButton = (page: Page) =>
  page.getByRole("button", { name: /^Export(, \d+% exported)?$/ }).first()
const sheet = (page: Page) =>
  page.getByRole("dialog", { name: "Export highlight" })
const items = (page: Page) =>
  sheet(page).getByRole("list", { name: "Your exports" }).getByRole("article")
const toastButton = (page: Page, name: string) =>
  page.locator("[data-sonner-toast]").getByRole("button", { name })
const fact = (page: Page, label: string) =>
  sheet(page).getByText(label, { exact: true }).locator("..")

async function openSheet(page: Page) {
  await exportButton(page).click()
  await expect(sheet(page)).toBeVisible()
}

test("nothing picked: Export is off, with the reason", async ({ page }) => {
  const { videoId } = await setUp(page, { reel: false })
  await page.goto(`/videos/${videoId}`)
  await openSheet(page)

  await expect(fact(page, "Clips")).toContainText("0")
  const start = sheet(page).getByRole("button", { name: "Export", exact: true })
  await expect(start).toBeDisabled()
  await expect(
    sheet(page).getByText("Pick some rallies first: your reel is empty."),
  ).toBeVisible()
  await expect(sheet(page).getByText("Your exports")).toHaveCount(0)
  // The sheet sits at the bottom of a phone, within the screen (once it slid in)
  await sheet(page).evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)),
  )
  const box = (await sheet(page).boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(844 + 1)
  expect(box.width).toBeLessThanOrEqual(390)
})

test("start an export: progress in the sheet and on the button; later edits don't change it", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}?mode=edit`)
  await openSheet(page)
  await expect(sheet(page)).toContainText(
    "It plays what Edit plays: your clips in their order",
  )
  await expect(fact(page, "Length")).toContainText("0:05")
  await expect(fact(page, "Clips")).toContainText("2")
  await expect(fact(page, "Format")).toContainText("16:9")
  // 720p; the 320×180 clip can't do 1080p
  const quality = sheet(page).getByRole("radiogroup", { name: "Quality" })
  await expect(quality.getByRole("radio", { name: "720p" })).toBeChecked()
  await expect(quality.getByRole("radio", { name: "1080p" })).toBeDisabled()
  await expect(
    sheet(page).getByText("1080p needs a 1080p recording"),
  ).toBeVisible()

  await sheet(page).getByRole("button", { name: "Export", exact: true }).click()
  await expect(items(page)).toHaveCount(1)
  await expect(items(page).first()).toContainText("0:05 · 720p · 16:9")
  await expect(items(page).first()).toContainText("Exported from your edit at")
  // One at a time
  await expect(
    sheet(page).getByText("One export at a time: wait for this one to finish."),
  ).toBeVisible()
  const [created] = await readExports(token, videoId)
  await setExportState(created.id, { status: "processing", progress: 0.42 })
  await expect(items(page).first()).toContainText("Exporting… 42%")

  // Closed: the button shows the progress, and editing goes on
  await page.keyboard.press("Escape")
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.getByTestId("export-badge")).toHaveText("42%")
  await page.getByRole("radio", { name: "Highlights" }).click()
  await page
    .getByRole("checkbox", { name: "Rally 2 in the reel" })
    .locator("..")
    .click()
  await expect(page.getByText("1 picked")).toBeVisible()

  // Done (a real MP4): a toast, the badge goes, the sheet shows it
  await renderExport(created.id)
  await expect(page.getByText("Your highlight is ready")).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId("export-badge")).toHaveCount(0)
  await toastButton(page, "Show").click()
  await expect(sheet(page).getByTestId("export-preview")).toBeVisible()
  // The new edit has one clip; the finished export is still the old one
  await expect(fact(page, "Clips")).toContainText("1")
  await expect(items(page).first()).toContainText("0:05 · 720p · 16:9")
  await expect(items(page).first()).toContainText("Available until")
})

for (const theme of ["dark", "light"] as const) {
  test(`done: preview, Download, Share (Web Share API or Download), delete (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => {
      localStorage.setItem("vite-ui-theme", t)
    }, theme)
    const { token, videoId } = await setUp(page)
    const exportId = await startExport(token, videoId)
    await renderExport(exportId)
    await page.goto(`/videos/${videoId}`)
    await openSheet(page)

    const preview = sheet(page).getByTestId("export-preview")
    await expect(preview).toBeVisible()
    await expect
      .poll(() =>
        preview.evaluate(
          (v: HTMLVideoElement) => v.readyState >= 1 && v.duration,
        ),
      )
      .toBeGreaterThan(5)
    // Named after the reel ("Test highlights")
    const filename = "test-highlights.mp4"
    const share = sheet(page).getByRole("button", { name: "Share" })
    const download = sheet(page).getByRole("button", { name: "Download" })

    // Download
    const downloaded = page.waitForEvent("download")
    await download.click()
    expect((await downloaded).suggestedFilename()).toBe(filename)

    // Share where the browser can share files: the MP4 itself
    await page.evaluate(() => {
      const w = window as unknown as { shared?: [string, string, number][] }
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      })
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          w.shared = (data.files ?? []).map((f) => [f.name, f.type, f.size])
        },
      })
    })
    await share.click()
    const shared = await page.waitForFunction(
      () => (window as unknown as { shared?: unknown }).shared,
    )
    const [[sharedName, type, size]] = (await shared.jsonValue()) as [
      string,
      string,
      number,
    ][]
    expect(sharedName).toBe(filename)
    expect(type).toBe("video/mp4")
    expect(size).toBeGreaterThan(1000)

    // Without file sharing (most desktop browsers): Share downloads instead
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: undefined,
      })
    })
    const fallback = page.waitForEvent("download")
    await share.click()
    expect((await fallback).suggestedFilename()).toBe(filename)

    // Delete, after a confirming second tap
    await sheet(page)
      .getByRole("button", { name: "Delete this export" })
      .click()
    await sheet(page)
      .getByRole("button", { name: "Confirm: delete this export" })
      .click()
    await expect(page.getByText("Export deleted")).toBeVisible()
    await expect(sheet(page).getByText("Your exports")).toHaveCount(0)
    await expect.poll(() => readExports(token, videoId)).toEqual([])
  })
}

test("a failure shows its reason; Try again renders the same edit", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)
  await openSheet(page)
  await sheet(page).getByRole("button", { name: "Export", exact: true }).click()
  await expect(items(page)).toHaveCount(1)
  await page.keyboard.press("Escape")
  const [created] = await readExports(token, videoId)

  // Fails while the sheet is closed: a toast with the reason
  await setExportState(created.id, {
    status: "failed",
    failure_reason: "Couldn't read the original video",
  })
  await expect(page.getByText("The export failed")).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId("export-badge")).toHaveCount(0)
  await toastButton(page, "Show").click()
  const item = items(page).first()
  await expect(item).toContainText("Failed: Couldn't read the original video")

  await item.getByRole("button", { name: "Try again" }).click()
  await expect(item).toContainText(/Waiting to start…|Exporting…/)
  await expect
    .poll(async () => (await readExports(token, videoId)).map((e) => e.id))
    .toEqual([created.id]) // the same export, not a new one
  await renderExport(created.id)
  await expect(item.getByTestId("export-preview")).toBeVisible({
    timeout: 10_000,
  })
  await expect(item).toContainText("0:05 · 720p · 16:9")
})
