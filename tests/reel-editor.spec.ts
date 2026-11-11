import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  PLAYABLE_CLIP,
  readReel,
  saveReelElsewhere,
  uploadVideo,
} from "./utils/videos"

// The highlight editor's top half: Make a highlight, the header, the time row
// (undo / redo / format / full screen), the mode toggle, and autosave. Runs at
// phone width in Chromium, desktop WebKit and the iPhone project.

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
})

let cleanup: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

/** A fresh user with the playable clip, presented as analyzed. */
async function setUp(page: Page) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `reel-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId) // its reels go with it
  // The worker isn't part of the tests: present the clip as analyzed.
  await page.route(`**/api/v1/videos/${videoId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...(await response.json()), status: "done" },
    })
  })
  await logInUser(page, email, password)
  return { token, videoId, name }
}

const saveStatus = (page: Page) => page.getByTestId("save-status")
const formatChip = (page: Page) =>
  page.getByRole("button", { name: /^Format / })

test("Make a highlight picks the longest rallies and opens the editor", async ({
  page,
}) => {
  const { videoId, name } = await setUp(page)
  // Seven rallies; the five longest are (in match order) ids 101, 103-106.
  const lengths = [1, 3, 1, 4, 5, 6, 7]
  const rallies = lengths.map((length, i) => ({
    id: 100 + i,
    start: i * 1.5,
    end: i * 1.5 + length / 10,
    duration: length / 10,
  }))
  await page.route(`**/api/v1/videos/${videoId}/rallies`, (route) =>
    route.fulfill({ json: { data: rallies, count: rallies.length } }),
  )
  // These rallies aren't in the database (the backend would refuse their ids), so
  // answer the create ourselves and check what the app sent.
  let sent: { title: string; edit: { clips: { rally_id: number }[] } } | null =
    null
  await page.route(`**/api/v1/videos/${videoId}/reels`, async (route) => {
    sent = route.request().postDataJSON()
    const now = new Date().toISOString()
    await route.fulfill({
      status: 201,
      json: {
        id: "00000000-0000-4000-8000-00000000ree1",
        video_id: videoId,
        owner_id: "00000000-0000-4000-8000-000000000001",
        ...sent,
        created_at: now,
        updated_at: now,
      },
    })
  })

  await page.goto(`/videos/${videoId}`)
  await page.getByRole("button", { name: "Make a highlight" }).click()
  await page.waitForURL(/\/reels\//)

  expect(sent!.title).toBe(`${name} highlights`)
  expect(sent!.edit.clips.map((clip) => clip.rally_id)).toEqual([
    101, 103, 104, 105, 106,
  ])
  await expect(
    page.getByRole("heading", { name: `${name} highlights` }),
  ).toBeVisible()
  await expect(page.getByText("5 clips")).toBeVisible()
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled()
  await expect(page.getByText("Coming soon")).toBeVisible()
})

test("format changes autosave; undo and redo (buttons and keys)", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  const reelId = await createReel(token, videoId)
  await page.goto(`/videos/${videoId}/reels/${reelId}`)
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()

  await formatChip(page).click()
  await expect(formatChip(page)).toHaveText("9:16")
  await expect(saveStatus(page)).toHaveText("Saving…")
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect
    .poll(async () => (await readReel(token, reelId)).edit.format)
    .toBe("9:16")

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(formatChip(page)).toHaveText("16:9")
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect
    .poll(async () => (await readReel(token, reelId)).edit.format)
    .toBe("16:9")

  await page.getByRole("button", { name: "Redo" }).click()
  await expect(formatChip(page)).toHaveText("9:16")

  // Keyboard: Ctrl+Z / Ctrl+Shift+Z (⌘ on a Mac)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("ControlOrMeta+z")
  await expect(formatChip(page)).toHaveText("16:9")
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(formatChip(page)).toHaveText("9:16")
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect
    .poll(async () => (await readReel(token, reelId)).edit.format)
    .toBe("9:16")
})

test("a save that conflicts with another device loads the latest version", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  const reelId = await createReel(token, videoId)
  await page.goto(`/videos/${videoId}/reels/${reelId}`)
  await expect(saveStatus(page)).toHaveText("Saved")

  // Meanwhile, another tab saves a different version.
  await saveReelElsewhere(token, reelId, { format: "9:16", view: "full" })

  // This tab's change is now based on an old version: the backend refuses it.
  await formatChip(page).click()
  await expect(
    page.getByText("This highlight was changed somewhere else"),
  ).toBeVisible()
  await expect(saveStatus(page)).toHaveText("Saved")
  // The other device's version wins and is what the editor shows now.
  await expect(formatChip(page)).toHaveText("9:16")
  const reel = await readReel(token, reelId)
  expect(reel.edit).toMatchObject({ format: "9:16", view: "full" })
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()
})

test("mode toggle is in the URL; full screen works; no sideways scroll", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  const reelId = await createReel(token, videoId)
  await page.goto(`/videos/${videoId}/reels/${reelId}`)
  const mode = page.getByRole("radiogroup", { name: "Editor mode" })
  await expect(mode.getByRole("radio", { name: "Highlights" })).toBeChecked()

  await mode.getByRole("radio", { name: "Edit" }).click()
  await expect(page).toHaveURL(/\?mode=edit$/)
  await page.reload()
  await expect(
    page.getByRole("radiogroup", { name: "Editor mode" }).getByRole("radio", {
      name: "Edit",
    }),
  ).toBeChecked()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false)

  // Our own full screen, with the skip pill and the controls
  await page.getByRole("button", { name: "Full screen", exact: true }).click()
  const layer = page.getByRole("dialog", { name: /full screen$/ })
  await expect(layer).toBeVisible()
  await expect(layer.getByRole("switch", { name: "Skip breaks" })).toBeVisible()
  await expect(layer.getByTestId("video")).toBeVisible()
  await layer.getByRole("button", { name: "Exit full screen" }).click()
  await expect(layer).toHaveCount(0)
  await expect(page).toHaveURL(/\?mode=edit$/)
})
