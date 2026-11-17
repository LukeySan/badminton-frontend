import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  deleteVideo,
  PLAYABLE_CLIP,
  readRallies,
  readReel,
  SEEDED_RALLIES,
  type SeedRally,
  seedAnalysis,
  uploadVideo,
} from "./utils/videos"

// "Maybe" rallies from detector v1.1: rallies the detector was unsure about. They're
// drawn faded and dashed (scrubber and timeline), tagged in the list with Keep /
// Delete (rally fixes, undoable), filterable, played by skip-breaks, left out of the
// counts and the quick starts. Videos made by an older detector offer re-analyzing.
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

const maybe = ([start, end]: [number, number]): SeedRally => ({
  start,
  end,
  confidence: 0.5,
  is_maybe: true,
})

/**
 * SEEDED_RALLIES with rallies 3 (3.4-4.6 s) and 6 (9.4-9.8 s) as maybes. The sure
 * ones (1, 2, 4, 5, 7) are 4.2 s of play.
 */
const WITH_MAYBES: SeedRally[] = SEEDED_RALLIES.map((r, i) =>
  i === 2 || i === 5 ? maybe(r) : r,
)

async function setUp(
  page: Page,
  {
    rallies = WITH_MAYBES,
    detectorVersion = "v1.1-2026-11",
  }: { rallies?: SeedRally[]; detectorVersion?: string } = {},
) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `video-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId)
  await seedAnalysis(videoId, rallies, { detectorVersion })
  await logInUser(page, email, password)
  return { token, videoId }
}

const summary = (page: Page) => page.getByTestId("match-summary")
const chapters = (page: Page) => page.getByTestId("chapter")
const maybeChapters = (page: Page) =>
  page.locator('[data-testid="chapter"][data-maybe]')
const rows = (page: Page) =>
  page.getByRole("list", { name: "Rallies" }).locator("li")
const maybeRows = (page: Page) => rows(page).filter({ hasText: "Maybe" })
/** The time row's Undo (a fix's toast has an Undo button too). */
const undoButton = (page: Page) => page.getByTitle("Undo (⌘Z)")
const isMaybeOnServer = async (token: string, videoId: string) =>
  (await readRallies(token, videoId)).map((r) => r.is_maybe)

for (const theme of ["dark", "light"] as const) {
  test(`maybe chapters are faded and dashed, not just another color (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => {
      localStorage.setItem("vite-ui-theme", t)
    }, theme)
    const { videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}`)

    await expect(chapters(page)).toHaveCount(7)
    await expect(maybeChapters(page)).toHaveCount(2)
    // Rally 2: sure, and not the current one (rally 1 is, at 0 s)
    const sure = chapters(page).nth(1)
    const unsure = maybeChapters(page).first()
    // A dashed outline (a shape difference) around a fainter fill
    await expect(unsure).toHaveCSS("border-top-style", "dashed")
    await expect(sure).toHaveCSS("border-top-width", "0px")
    const fill = (el: Element) => getComputedStyle(el).backgroundColor
    expect(await unsure.evaluate(fill)).not.toBe(await sure.evaluate(fill))
    // The outline is the chapter color at full strength
    expect(
      await unsure.evaluate((el) => getComputedStyle(el).borderTopColor),
    ).toBe(await sure.evaluate(fill))
  })
}

test("the header counts sure rallies; maybe rows have a tag, Keep and Delete", async ({
  page,
}) => {
  const { videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)

  await expect(summary(page)).toHaveText("5 rallies · 0:04 play · 2 to check")
  await expect(rows(page)).toHaveCount(7)
  await expect(maybeRows(page)).toHaveCount(2)
  await expect(
    page.getByRole("button", { name: /^Play rally 3 \(maybe\),/ }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep rally 3" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Delete rally 6" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep rally 1" })).toHaveCount(
    0,
  )
  // Made by the current detector: nothing to re-analyze
  await page.getByRole("button", { name: "More options" }).click()
  await expect(
    page.getByRole("menuitem", { name: "Re-mark court" }),
  ).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Re-analyze/ })).toHaveCount(
    0,
  )

  // Nothing sideways at phone width (the chips scroll inside their own row)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test("Keep makes it a rally; undo makes it a maybe again", async ({ page }) => {
  const { token, videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)

  await page.getByRole("button", { name: "Keep rally 3" }).click()
  await expect(page.getByText("Rally 3 kept")).toBeVisible()
  await expect(maybeChapters(page)).toHaveCount(1)
  await expect(maybeRows(page)).toHaveCount(1)
  await expect(summary(page)).toHaveText("6 rallies · 0:05 play · 1 to check")
  await expect
    .poll(() => isMaybeOnServer(token, videoId))
    .toEqual([false, false, false, false, false, true, false])

  await undoButton(page).click()
  await expect(page.getByText("Rally fix undone")).toBeVisible()
  await expect(maybeChapters(page)).toHaveCount(2)
  await expect(summary(page)).toHaveText("5 rallies · 0:04 play · 2 to check")
  await expect
    .poll(() => isMaybeOnServer(token, videoId))
    .toEqual([false, false, true, false, false, true, false])
})

test("Delete removes it; undo brings it back as a maybe", async ({ page }) => {
  const { token, videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)

  await page.getByRole("button", { name: "Delete rally 6" }).click()
  await expect(page.getByText("Rally 6 deleted")).toBeVisible()
  await expect(rows(page)).toHaveCount(6)
  await expect(maybeChapters(page)).toHaveCount(1)
  await expect(summary(page)).toHaveText("5 rallies · 0:04 play · 1 to check")
  await expect
    .poll(async () => (await readRallies(token, videoId)).length)
    .toBe(6)

  await undoButton(page).click()
  await expect(rows(page)).toHaveCount(7)
  await expect(maybeChapters(page)).toHaveCount(2)
  await expect(maybeRows(page)).toHaveCount(2)
  await expect
    .poll(async () =>
      (await readRallies(token, videoId)).map((r) => [
        r.start,
        r.end,
        r.is_maybe,
      ]),
    )
    .toEqual(
      SEEDED_RALLIES.map(([start, end], i) => [start, end, i === 2 || i === 5]),
    )
})

test("the Maybe filter goes through them in a row", async ({ page }) => {
  const { videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)

  await page.getByRole("radio", { name: "Maybe 2" }).click()
  await expect(rows(page)).toHaveCount(2)

  // Answered rows leave the filter
  await page.getByRole("button", { name: "Keep rally 3" }).click()
  await expect(page.getByText("Rally 3 kept")).toBeVisible()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByRole("radio", { name: "Maybe 1" })).toBeChecked()
  await page.getByRole("button", { name: "Delete rally 6" }).click()
  await expect(page.getByText("Rally 6 deleted")).toBeVisible()
  await expect(
    page.getByText("All checked: no maybe rallies left."),
  ).toBeVisible()
  await expect(summary(page)).toHaveText("6 rallies · 0:05 play")

  // Undo the delete: it's back in the filter
  await undoButton(page).click()
  await expect(page.getByRole("radio", { name: "Maybe 1" })).toBeChecked()
  await expect(rows(page)).toHaveCount(1)

  // The chip is only there while there's something to check
  await page.getByRole("button", { name: "Keep rally 6" }).click()
  await expect(page.getByText("Rally 6 kept")).toBeVisible()
  await page.getByRole("radio", { name: /^All/ }).click()
  await expect(page.getByRole("radio", { name: /^Maybe/ })).toHaveCount(0)
})

test("quick starts leave maybes out; the timeline draws them dashed", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  const rallies = await readRallies(token, videoId)
  await page.goto(`/videos/${videoId}?mode=edit`)

  // Only the 5 sure rallies: the longest five of all would include 3 and 6
  await expect(
    page.getByRole("button", { name: /^All rallies/ }),
  ).toContainText("Leaves out the 2 to check")
  await page.getByRole("button", { name: /^Longest 5/ }).click()
  await expect(page.getByTestId("clip")).toHaveCount(5)
  await expect
    .poll(
      async () =>
        (await readReel(token, videoId))?.edit.clips.map((c) => c.rally_id),
      { timeout: 10_000 },
    )
    .toEqual([0, 1, 3, 4, 6].map((i) => rallies[i].id))

  // Full video shows the unpicked maybes, faded and dashed; one tap adds one
  await page.getByRole("radio", { name: "Full video" }).click()
  const unpicked = page.locator('[data-testid="unpicked"][data-maybe]')
  await expect(unpicked).toHaveCount(2)
  await page
    .getByRole("button", {
      name: "Rally 3 (maybe), not in the reel. Tap to add",
    })
    .click()
  await expect(page.locator('[data-testid="clip"][data-maybe]')).toHaveCount(1)

  // Undo the add, Full video and Longest 5
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Your reel is empty")).toBeVisible()
  await page.getByRole("button", { name: /^All rallies/ }).click()
  await expect(page.getByTestId("clip")).toHaveCount(5)
})

test("skip breaks plays maybe rallies (a missed rally is worse than a fake)", async ({
  page,
}) => {
  // Played spans (rally ± 1 s): 0-2.3, the maybe 4-7, 9.6-12
  const { videoId } = await setUp(page, {
    rallies: [[0.5, 1.3], maybe([5, 6]), [10.6, 11.6]],
  })
  await page.goto(`/videos/${videoId}`)
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 1,
  )
  const skip = page.getByRole("switch", { name: "Skip breaks" })
  await skip.click()
  await expect(skip).toHaveAttribute("aria-checked", "true")

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const video = document.querySelector("video")!
        video.addEventListener("seeked", () => resolve(), { once: true })
        window.setTimeout(resolve, 3000)
        video.currentTime = 2
      }),
  )
  await page.evaluate(() => {
    const video = document.querySelector("video")!
    const w = window as unknown as { seen: number[] }
    w.seen = []
    const tick = () => {
      w.seen.push(video.currentTime)
      video.requestVideoFrameCallback?.(tick)
    }
    video.requestVideoFrameCallback?.(tick)
    video.addEventListener("timeupdate", () => w.seen.push(video.currentTime))
  })
  await page.getByRole("button", { name: "Play", exact: true }).first().click()
  // From the break after rally 1 straight into the maybe, not on to rally 3 (9.6 s)
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("video")!.currentTime),
    )
    .toBeGreaterThan(4.3)
  await page.getByRole("button", { name: "Pause", exact: true }).first().click()
  const seen = await page.evaluate(
    () => (window as unknown as { seen: number[] }).seen,
  )
  expect(seen.filter((t) => t > 2.5 && t < 3.9)).toEqual([])
  expect(seen.filter((t) => t >= 4 && t < 7).length).toBeGreaterThan(0)
  expect(seen.filter((t) => t > 7.2 && t < 9.5)).toEqual([])
})

test("an older detector's video: no maybes, and Re-analyze with the latest one", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    rallies: SEEDED_RALLIES,
    detectorVersion: "v1",
  })
  await page.goto(`/videos/${videoId}`)
  await expect(summary(page)).toHaveText("7 rallies · 0:06 play")
  await expect(maybeChapters(page)).toHaveCount(0)
  await expect(page.getByRole("radio", { name: /^Maybe/ })).toHaveCount(0)

  // The backend queues it; answered here so no worker picks the test video up
  const video = await (
    await fetch(`${process.env.VITE_API_URL}/api/v1/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()
  let queued = false
  await page.route(`**/api/v1/videos/${videoId}/process`, (route) => {
    queued = true
    return route.fulfill({
      json: { ...video, status: "queued", progress: 0 },
    })
  })

  await page.getByRole("button", { name: "More options" }).click()
  await page
    .getByRole("menuitem", { name: "Re-analyze with the latest detector" })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "Re-analyze with the latest detector?",
  })
  await expect(dialog).toContainText("fixes you made to them are lost")
  await dialog.getByRole("button", { name: "Re-analyze" }).click()
  await expect(page.getByText("Waiting to start")).toBeVisible()
  expect(queued).toBe(true)
})
