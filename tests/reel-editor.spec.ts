import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  PLAYABLE_CLIP,
  readRallies,
  readReel,
  saveReelElsewhere,
  seedAnalysis,
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

/** A fresh user with the playable clip, analyzed with SEEDED_RALLIES (real rows). */
async function setUp(page: Page) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `reel-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId) // its reels go with it
  await seedAnalysis(videoId)
  const rallies = await readRallies(token, videoId)
  await logInUser(page, email, password)
  return { token, videoId, name, rallies }
}

const saveStatus = (page: Page) => page.getByTestId("save-status")
const formatChip = (page: Page) =>
  page.getByRole("button", { name: /^Format / })

test("Make a highlight picks the five longest rallies and opens the editor", async ({
  page,
}) => {
  const { token, videoId, name, rallies } = await setUp(page)
  await page.goto(`/videos/${videoId}`)
  await page.getByRole("button", { name: "Make a highlight" }).click()
  await page.waitForURL(/\/reels\//)
  const reelId = page.url().split("/reels/")[1].split("?")[0]

  await expect(
    page.getByRole("heading", { name: `${name} highlights` }),
  ).toBeVisible()
  await expect(page.getByText("5 rallies ·")).toBeVisible()
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled()
  await expect(page.getByText("Coming soon")).toBeVisible()
  // Rallies 1, 3, 5, 6, 7 (the longest five), in match order
  const reel = await readReel(token, reelId)
  const clips = reel.edit.clips as { rally_id: number }[]
  expect(clips.map((c) => c.rally_id)).toEqual(
    [0, 2, 4, 5, 6].map((i) => rallies[i].id),
  )
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

// --- Highlights mode ---------------------------------------------------------------

const check = (page: Page, n: number) =>
  page.getByRole("checkbox", { name: `Rally ${n} in the reel` })
/** Tap the round check (the checkbox's label: the input itself is visually hidden). */
const tapCheck = (page: Page, n: number) => check(page, n).locator("..").click()
const bar = (page: Page) => page.getByText(/^\d+ picked$/)

test.describe("Highlights mode", () => {
  test("pick and unpick with the check; autosaved; undo", async ({ page }) => {
    const { token, videoId, rallies } = await setUp(page)
    const reelId = await createReel(token, videoId)
    await page.goto(`/videos/${videoId}/reels/${reelId}`)
    await expect(bar(page)).toHaveText("0 picked")

    await tapCheck(page, 5)
    await tapCheck(page, 2)
    await expect(check(page, 5)).toBeChecked()
    await expect(bar(page)).toHaveText("2 picked")
    // Saved in match order, padded but not overlapping each other
    await expect
      .poll(async () =>
        (
          (await readReel(token, reelId)).edit.clips as { rally_id: number }[]
        ).map((c) => c.rally_id),
      )
      .toEqual([rallies[1].id, rallies[4].id])
    const clips = (await readReel(token, reelId)).edit.clips as {
      trim_start: number
      trim_end: number
    }[]
    expect(clips[0]).toMatchObject({ trim_start: 1.3, trim_end: 3.6 })
    expect(clips[1]).toMatchObject({ trim_start: 5.8, trim_end: 9.6 })

    await tapCheck(page, 5)
    await expect(bar(page)).toHaveText("1 picked")
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(bar(page)).toHaveText("2 picked")
    await expect(check(page, 5)).toBeChecked()
  })

  test("filters: picked only, and longest first", async ({ page }) => {
    const { token, videoId, rallies } = await setUp(page)
    const reelId = await createReel(token, videoId, "Test", {
      clips: [rallies[2], rallies[6]].map((r) => ({
        rally_id: r.id,
        trim_start: r.start,
        trim_end: r.end,
      })),
    })
    await page.goto(`/videos/${videoId}/reels/${reelId}`)
    const rows = page.getByRole("list", { name: "Rallies" }).locator("li")
    await expect(rows).toHaveCount(7)

    await page.getByRole("radio", { name: "Picked 2" }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText("Rally 3")
    await expect(rows.nth(1)).toContainText("Rally 7")

    await page.getByRole("radio", { name: "Longest" }).click()
    await expect(rows).toHaveCount(7)
    // 1.8 s, 1.2 s, 1.0 s, ...
    await expect(rows.nth(0)).toContainText("Rally 5")
    await expect(rows.nth(1)).toContainText("Rally 3")
    await expect(rows.nth(2)).toContainText("Rally 7")
  })

  test("tap a row: jumps there and marks it as playing", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    const reelId = await createReel(token, videoId)
    await page.goto(`/videos/${videoId}/reels/${reelId}`)
    await page.waitForFunction(
      () => (document.querySelector("video")?.readyState ?? 0) >= 1,
    )

    await page.getByRole("button", { name: /^Play rally 5,/ }).click()
    // Rally 5 starts at 6.8 s; the player plays it with 1 s of padding
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("video")!.currentTime),
      )
      .toBeGreaterThanOrEqual(5.8)
    // Past rally 4's padding (to 6.9 s), where rally 5 is the only one playing
    await expect
      .poll(
        () => page.evaluate(() => document.querySelector("video")!.currentTime),
        { timeout: 5000 },
      )
      .toBeGreaterThan(7)
    await page.evaluate(() => document.querySelector("video")!.pause())
    const row = page.locator('li[data-number="5"] [aria-current="true"]')
    await expect(row).toBeVisible()
    await expect(row).toContainText("Playing")
    await expect(page.getByTestId("current-rally")).toHaveText("Rally 5")
  })

  test("Edit reel opens the Edit mode", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    const reelId = await createReel(token, videoId)
    await page.goto(`/videos/${videoId}/reels/${reelId}`)
    await page.getByRole("button", { name: "Edit reel" }).click()
    await expect(page).toHaveURL(/\?mode=edit$/)
    await expect(
      page.getByRole("radio", { name: "Edit", exact: true }),
    ).toBeChecked()
  })
})
