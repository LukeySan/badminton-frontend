import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  PLAYABLE_CLIP,
  rallyBounds,
  readRallies,
  readReel,
  reelOf,
  SEEDED_RALLIES,
  saveReelElsewhere,
  seedAnalysis,
  uploadVideo,
} from "./utils/videos"

// The video screen (/videos/$id once analyzed), one screen in two modes. Highlights
// is the player: chapters, stats, previous / next, the rally list with picks, filters
// and rally fixes. Edit is the reel (edit list v5, a flat list of clips): empty state
// with quick starts, timeline, cut / slow-mo / text / format, preview playback,
// thumbnails. Edge drags, reorder, zoom and Add footage: video-screen-edit. The reel
// (one per video) is created on the first change and autosaved. Full screen:
// video-screen-fullscreen. Runs at phone width in Chromium, desktop WebKit and the
// iPhone project.
//
// A picked rally becomes a clip of the rally plus 1 s each side (inside the video):
//   R1 0-2.3  R2 1.3-3.6  R3 2.4-5.6  R4 4.6-6.9  R5 5.8-9.6  R6 8.4-10.8  R7 9.6-12

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
async function setUp(page: Page, { thumbnails = false } = {}) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `video-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId) // its reel goes with it
  await seedAnalysis(videoId, SEEDED_RALLIES, { thumbnails })
  const rallies = await readRallies(token, videoId)
  await logInUser(page, email, password)
  return { token, videoId, name, rallies }
}

const saveStatus = (page: Page) => page.getByTestId("save-status")
/** Server-side checks wait for the debounced autosave (slow machines, CI). */
const SAVE_TIMEOUT = 10_000
/** Longer than the autosave's debounce: a save would have started by then. */
const NO_SAVE_WAIT = 1500
const formatChip = (page: Page) =>
  page.getByRole("button", { name: /^Format / })
const modes = (page: Page) =>
  page.getByRole("radiogroup", { name: "Editor mode" })

// --- The screen, and its reel ------------------------------------------------------

test("a done video opens the screen: header, Highlights first, no reel yet", async ({
  page,
}) => {
  const { token, videoId, name } = await setUp(page)
  await page.goto(`/videos/${videoId}`)

  await expect(page.getByRole("heading", { name })).toBeVisible()
  // 7 rallies, 5.8 s of play in all
  await expect(page.getByTestId("match-summary")).toHaveText(
    "7 rallies · 0:06 play",
  )
  // Export opens its sheet (video-screen-export.spec.ts)
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled()
  await expect(
    modes(page).getByRole("radio", { name: "Highlights" }),
  ).toBeChecked()
  // Nothing picked, nothing to save
  await expect(page.getByText("0 picked")).toBeVisible()
  await expect(saveStatus(page)).toHaveCount(0)

  // Watching, filtering and switching modes never create a reel
  await page.getByRole("button", { name: /^Play rally 3,/ }).click()
  await page.getByRole("radio", { name: "Longest" }).click()
  await modes(page).getByRole("radio", { name: "Edit" }).click()
  await expect(page.getByText("Your reel is empty")).toBeVisible()
  await page.waitForTimeout(NO_SAVE_WAIT)
  expect(await readReel(token, videoId)).toBeNull()

  // The first pick creates it, named after the video
  await modes(page).getByRole("radio", { name: "Highlights" }).click()
  await check(page, 5).locator("..").click()
  await expect(saveStatus(page)).toHaveText("Saved")
  const reel = await reelOf(token, videoId)
  expect(reel.title).toBe(`${name} highlights`)
  expect(reel.edit.segments).toHaveLength(1)

  // Back goes Home
  await page.getByRole("link", { name: "Back to Home" }).click()
  await page.waitForURL("/")
})

test("a setting change creates the reel too; undo and redo (buttons and keys)", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}?mode=edit`)
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()

  await formatChip(page).click()
  await expect(formatChip(page)).toHaveText("9:16")
  await expect(saveStatus(page)).toHaveText("Saving…")
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect
    .poll(async () => (await readReel(token, videoId))?.edit.format, {
      timeout: SAVE_TIMEOUT,
    })
    .toBe("9:16")

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(formatChip(page)).toHaveText("16:9")
  await expect(saveStatus(page)).toHaveText("Saved")
  await expect
    .poll(async () => (await readReel(token, videoId))?.edit.format, {
      timeout: SAVE_TIMEOUT,
    })
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
    .poll(async () => (await readReel(token, videoId))?.edit.format, {
      timeout: SAVE_TIMEOUT,
    })
    .toBe("9:16")
})

test("a save that conflicts with another device loads the latest version", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await createReel(token, videoId)
  await page.goto(`/videos/${videoId}?mode=edit`)
  await expect(saveStatus(page)).toHaveText("Saved")

  // Meanwhile, another tab saves a different version.
  await saveReelElsewhere(token, videoId, { format: "9:16" })

  // This tab's change is now based on an old version: the backend refuses it.
  await formatChip(page).click()
  await expect(
    page.getByText("Your reel was changed somewhere else"),
  ).toBeVisible()
  await expect(saveStatus(page)).toHaveText("Saved")
  // The other device's version wins and is what the screen shows now.
  await expect(formatChip(page)).toHaveText("9:16")
  const reel = await reelOf(token, videoId)
  expect(reel.edit).toMatchObject({ format: "9:16" })
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()
})

test("two tabs creating the reel at once: one wins, the other loads it", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  const loaded = page.waitForResponse((r) =>
    r.url().endsWith(`/videos/${videoId}/reel`),
  )
  await page.goto(`/videos/${videoId}?mode=edit`)
  expect((await loaded).status()).toBe(404) // no reel yet
  // Another tab made the reel after this one opened (this one still thinks none)
  await createReel(token, videoId, { format: "9:16" })

  await page.getByRole("button", { name: "All rallies" }).click()
  await expect(
    page.getByText("Your reel was changed somewhere else"),
  ).toBeVisible()
  // The other tab's reel (no clips, 9:16) is what's shown and stored
  await expect(page.getByText("Your reel is empty")).toBeVisible()
  await expect(formatChip(page)).toHaveText("9:16")
  expect((await readReel(token, videoId))?.edit.segments).toEqual([])
})

test("mode toggle is in the URL; full screen works; no sideways scroll", async ({
  page,
}) => {
  const { videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)
  await expect(
    modes(page).getByRole("radio", { name: "Highlights" }),
  ).toBeChecked()

  await modes(page).getByRole("radio", { name: "Edit" }).click()
  await expect(page).toHaveURL(/\?mode=edit$/)
  await page.reload()
  await expect(modes(page).getByRole("radio", { name: "Edit" })).toBeChecked()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false)

  // Our own full screen, with the controls
  await page.getByRole("button", { name: "Full screen", exact: true }).click()
  const layer = page.getByRole("dialog", { name: /full screen$/ })
  await expect(layer).toBeVisible()
  // Edit plays the reel's clips (footage, not rallies): no rally badge, and no
  // breaks, so no skip-breaks pill
  await expect(layer.getByTestId("current-rally")).toHaveCount(0)
  await expect(layer.getByRole("switch", { name: "Skip breaks" })).toHaveCount(
    0,
  )
  await expect(layer.getByTestId("video")).toBeVisible()
  await layer.getByRole("button", { name: "Exit full screen" }).click()
  await expect(layer).toHaveCount(0)
  await expect(page).toHaveURL(/\?mode=edit$/)
})

test("old highlight links open the video's screen", async ({ page }) => {
  const { videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}/reels/some-old-reel?mode=edit`)
  await expect(page).toHaveURL(`/videos/${videoId}?mode=edit`)
  await expect(modes(page).getByRole("radio", { name: "Edit" })).toBeChecked()
})

// --- Edit with nothing picked: quick starts ----------------------------------------------

test.describe("Empty reel", () => {
  test("Longest 5 picks the five longest; undo empties it again", async ({
    page,
  }) => {
    const { token, videoId, rallies } = await setUp(page)
    await page.goto(`/videos/${videoId}?mode=edit`)
    await expect(page.getByText("Your reel is empty")).toBeVisible()

    await page.getByRole("button", { name: /^Longest 5/ }).click()
    await expect(page.getByTestId("clip")).toHaveCount(5)
    // Rallies 1, 3, 5, 6, 7 (the longest five), in match order, in one undo step
    await expect
      .poll(
        async () =>
          (await readReel(token, videoId))?.edit.segments.map(
            (c) => c.rally_id,
          ),
        { timeout: SAVE_TIMEOUT },
      )
      .toEqual([0, 2, 4, 5, 6].map((i) => rallies[i].id))
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(page.getByText("Your reel is empty")).toBeVisible()
  })

  test("All rallies picks every rally", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}?mode=edit`)
    await page.getByRole("button", { name: /^All rallies/ }).click()
    await expect(page.getByTestId("clip")).toHaveCount(7)
    await expect
      .poll(
        async () => (await readReel(token, videoId))?.edit.segments.length,
        { timeout: SAVE_TIMEOUT },
      )
      .toBe(7)
  })

  test("Pick from the list goes to Highlights with the Picked hint", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}?mode=edit`)
    await page.getByRole("button", { name: /^Pick from the list/ }).click()

    await expect(page).not.toHaveURL(/mode=edit/)
    const hint = page.getByTestId("pick-hint")
    await expect(hint).toContainText("Tap the circle next to a rally")
    await expect(hint).toContainText("Picked")
    await check(page, 3).locator("..").click()
    await page.getByRole("radio", { name: "Picked 1" }).click()
    await expect(rows(page)).toHaveCount(1)
    await page.getByRole("button", { name: "Hide the hint" }).click()
    await expect(hint).toHaveCount(0)
    // Nothing was created until the pick
    await expect
      .poll(
        async () => (await readReel(token, videoId))?.edit.segments.length,
        { timeout: SAVE_TIMEOUT },
      )
      .toBe(1)
  })
})

// --- Highlights: the player ----------------------------------------------------------

test("Highlights is the player: chapters, stats, previous / next and keys", async ({
  page,
}) => {
  const { videoId } = await setUp(page)
  await page.goto(`/videos/${videoId}`)
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 1,
  )

  // The match's 7 chapters under the video, and the stats over all rallies
  await expect(page.getByTestId("chapter")).toHaveCount(7)
  await expect(page.getByText("Actual play")).toBeVisible()
  await expect(page.getByText("Breaks cut")).toBeVisible()

  // In rally 5: the badge, and its length in the stats
  await seekTo(page, 7)
  const badge = page.getByTestId("current-rally").first()
  await expect(badge).toHaveText("Rally 5 of 7")
  await expect(page.getByText("1.8s")).toBeVisible()

  // → : the next rally, from its padding (rally 6 at 9.4 s, so 8.4 s)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => videoTimeOf(page)).toBeGreaterThanOrEqual(8.35)
  expect(await videoTimeOf(page)).toBeLessThan(9.4)
  // Previous rally (the button): 8.4 s is still in rally 5, less than 3 s into it,
  // so it goes to the one before (rally 4 from 4.6 s), like a music app
  await page.getByRole("button", { name: "Previous rally" }).click()
  await expect.poll(() => videoTimeOf(page)).toBeLessThan(5.7)
  expect(await videoTimeOf(page)).toBeGreaterThanOrEqual(4.55)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
})

// --- Shared helpers ----------------------------------------------------------------

/**
 * A reel with rallies 1 and 5 as the app picks them (1 s of padding each side):
 * R1 0-2.3 s, then R5 5.8-9.6 s. 6.1 s long.
 */
async function reelWithTwoClips(token: string, videoId: string) {
  const rallies = await readRallies(token, videoId)
  await createReel(token, videoId, {
    version: 5,
    segments: [
      { id: "c1", start: 0, end: 2.3, rally_id: rallies[0].id },
      { id: "c5", start: 5.8, end: 9.6, rally_id: rallies[4].id },
    ],
  })
}

/** The reel's clips as [start, end] pairs, as saved on the server. */
const spansOf = async (token: string, videoId: string) =>
  (await readReel(token, videoId))?.edit.segments.map((s) => [s.start, s.end])

/**
 * Opens the reel in Edit mode once the video's metadata is in (enough to seek;
 * seekTo waits for the frame itself).
 */
async function openEdit(page: Page, videoId: string) {
  await page.goto(`/videos/${videoId}?mode=edit`)
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 1,
  )
}

/**
 * Puts the (paused) video at `t` and waits until it's there. WebKit fires no
 * "seeked" for a seek to where the video already is: then it's done right away.
 */
const seekTo = (page: Page, t: number) =>
  page.evaluate(
    (seconds) =>
      new Promise<void>((resolve) => {
        const video = document.querySelector("video")!
        video.pause()
        if (Math.abs(video.currentTime - seconds) < 1e-3 && !video.seeking) {
          resolve()
          return
        }
        video.addEventListener("seeked", () => resolve(), { once: true })
        window.setTimeout(resolve, 3000) // never hang the test on a lost event
        video.currentTime = seconds
      }),
    t,
  )

const videoTimeOf = (page: Page) =>
  page.evaluate(() => document.querySelector("video")!.currentTime)
const tools = (page: Page) => page.getByRole("toolbar", { name: "Edit tools" })
const cutButton = (page: Page) =>
  tools(page).getByRole("button", { name: /^Cut/ })
const deleteButton = (page: Page) =>
  tools(page).getByRole("button", { name: /^Delete/ })
const hint = (page: Page) => page.getByTestId("selection-hint")
/** The time row's buttons (a rally fix's toast has an Undo button too). */
const undoButton = (page: Page) => page.getByTitle("Undo (⌘Z)")

// --- Phone layout: one screen -------------------------------------------------------

/**
 * `bar` ends at the viewport's bottom edge, and its content ends its bottom padding
 * (the safe area plus our spacing) above it: pinned, not floating.
 */
async function expectPinned(
  page: Page,
  bar: ReturnType<Page["locator"]>,
  content: ReturnType<Page["locator"]>,
) {
  const height = page.viewportSize()!.height
  await expect
    .poll(async () => {
      const box = await bar.boundingBox()
      return box ? Math.abs(box.y + box.height - height) : Number.NaN
    })
    .toBeLessThanOrEqual(2)
  const padding = await bar.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).paddingBottom),
  )
  expect(padding).toBeGreaterThanOrEqual(16)
  const box = (await content.boundingBox())!
  expect(Math.abs(box.y + box.height - (height - padding))).toBeLessThanOrEqual(
    2,
  )
}

/** Nothing scrolls the page itself (only the rally list and the timeline scroll). */
const pageScrolls = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement!
    return (
      root.scrollHeight > window.innerHeight + 1 ||
      root.scrollWidth > window.innerWidth + 1
    )
  })

test.describe("Phone layout", () => {
  for (const [width, height] of [
    [390, 844],
    [390, 664], // a short phone
    [430, 932],
  ] as const) {
    test(`${width}×${height}: tools and bottom bar pinned to the bottom, the page never scrolls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      const { token, videoId } = await setUp(page)
      await reelWithTwoClips(token, videoId)

      // Edit: the timeline fills the space down to the hint; the tools sit below
      await openEdit(page, videoId)
      const toolbar = tools(page)
      await expectPinned(
        page,
        toolbar,
        toolbar.getByRole("button", { name: "Slow-mo" }),
      )
      const timeline = (await page.getByTestId("timeline").boundingBox())!
      const hintBox = (await hint(page).boundingBox())!
      expect(
        Math.abs(timeline.y + timeline.height - hintBox.y),
      ).toBeLessThanOrEqual(2)
      expect(timeline.height).toBeGreaterThanOrEqual(height >= 800 ? 200 : 90)
      expect(await pageScrolls(page)).toBe(false)

      // Highlights: the list takes the room, its bar is pinned the same way
      await modes(page).getByRole("radio", { name: "Highlights" }).click()
      const bar = page.getByTestId("highlights-bar")
      await expectPinned(
        page,
        bar,
        bar.getByRole("button", { name: /Edit reel/ }),
      )
      expect(await pageScrolls(page)).toBe(false)
      // The list scrolls inside itself when it's longer than its room
      const list = page.getByRole("list", { name: "Rallies" })
      const listBox = (await list.boundingBox())!
      const barBox = (await bar.boundingBox())!
      expect(listBox.y + listBox.height).toBeLessThanOrEqual(barBox.y + 1)
    })
  }
})

// --- Highlights mode ---------------------------------------------------------------

const check = (page: Page, n: number) =>
  page.getByRole("checkbox", { name: `Rally ${n} in the reel` })
/** Tap the round check (the checkbox's label: the input itself is visually hidden). */
const tapCheck = (page: Page, n: number) => check(page, n).locator("..").click()
const bar = (page: Page) => page.getByText(/^\d+ picked$/)
const rows = (page: Page) =>
  page.getByRole("list", { name: "Rallies" }).locator("li")

test.describe("Highlights mode", () => {
  test("pick and unpick with the check; autosaved; undo", async ({ page }) => {
    const { token, videoId, rallies } = await setUp(page)
    await page.goto(`/videos/${videoId}`)
    await expect(bar(page)).toHaveText("0 picked")

    await tapCheck(page, 5)
    await tapCheck(page, 2)
    await expect(check(page, 5)).toBeChecked()
    await expect(bar(page)).toHaveText("2 picked")
    // Saved in match order, each its rally with 1 s before and after
    await expect
      .poll(
        async () =>
          (await readReel(token, videoId))?.edit.segments.map(
            (c) => c.rally_id,
          ),
        { timeout: SAVE_TIMEOUT },
      )
      .toEqual([rallies[1].id, rallies[4].id])
    expect(await spansOf(token, videoId)).toEqual([
      [1.3, 3.6],
      [5.8, 9.6],
    ])

    await tapCheck(page, 5)
    await expect(bar(page)).toHaveText("1 picked")
    await undoButton(page).click()
    await expect(bar(page)).toHaveText("2 picked")
    await expect(check(page, 5)).toBeChecked()
  })

  test("filters: picked only, and longest first", async ({ page }) => {
    const { token, videoId, rallies } = await setUp(page)
    await createReel(token, videoId, {
      version: 5,
      segments: [rallies[2], rallies[6]].map((r, i) => ({
        id: `c${i + 1}`,
        start: r.start,
        end: r.end,
        rally_id: r.id,
      })),
    })
    await page.goto(`/videos/${videoId}`)
    await expect(rows(page)).toHaveCount(7)

    await page.getByRole("radio", { name: "Picked 2" }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(rows(page).nth(0)).toContainText("Rally 3")
    await expect(rows(page).nth(1)).toContainText("Rally 7")

    await page.getByRole("radio", { name: "Longest" }).click()
    await expect(rows(page)).toHaveCount(7)
    // 1.8 s, 1.2 s, 1.0 s, ...
    await expect(rows(page).nth(0)).toContainText("Rally 5")
    await expect(rows(page).nth(1)).toContainText("Rally 3")
    await expect(rows(page).nth(2)).toContainText("Rally 7")
  })

  test("tap a row: jumps there and marks it as playing", async ({ page }) => {
    const { videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}`)
    await page.waitForFunction(
      () => (document.querySelector("video")?.readyState ?? 0) >= 1,
    )

    await page.getByRole("button", { name: /^Play rally 5,/ }).click()
    // Rally 5 starts at 6.8 s; the player plays it with 1 s of padding
    await expect.poll(() => videoTimeOf(page)).toBeGreaterThanOrEqual(5.8)
    // Past rally 4's padding (to 6.9 s), where rally 5 is the only one playing
    await expect
      .poll(() => videoTimeOf(page), { timeout: 5000 })
      .toBeGreaterThan(7)
    await page.evaluate(() => document.querySelector("video")!.pause())
    const row = page.locator('li[data-number="5"] [aria-current="true"]')
    await expect(row).toBeVisible()
    await expect(row).toContainText("Playing")
    await expect(page.getByTestId("current-rally")).toHaveText("Rally 5 of 7")
  })

  test("Edit reel opens the Edit mode", async ({ page }) => {
    const { videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}`)
    await page.getByRole("button", { name: "Edit reel" }).click()
    await expect(page).toHaveURL(/\?mode=edit$/)
    await expect(
      page.getByRole("radio", { name: "Edit", exact: true }),
    ).toBeChecked()
  })
})

// --- Rally fixes (Highlights' ⋮ menu) ----------------------------------------------

const fix = async (page: Page, n: number, item: string) => {
  await page.getByRole("button", { name: `Fix rally ${n}` }).click()
  await page.getByRole("menuitem", { name: item }).click()
}
const seeded = SEEDED_RALLIES.map(([start, end]) => [start, end])

test.describe("Rally fixes", () => {
  test("fix start and end: the backend's refusal shows; the reel stays; undo", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await page.goto(`/videos/${videoId}`)

    await fix(page, 5, "Fix start and end")
    const dialog = page.getByRole("dialog", { name: "Fix rally 5" })
    // 9.6 s reaches into rally 6 (9.4 s): refused, with the backend's reason
    await dialog.getByRole("button", { name: "End 1 s later" }).click()
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog.getByRole("alert")).toBeVisible()
    await dialog.getByRole("button", { name: "End 1 s earlier" }).click()
    for (let i = 0; i < 3; i++)
      await dialog.getByRole("button", { name: "Start 0.1 s earlier" }).click()
    await expect(dialog.getByLabel("Start", { exact: true })).toHaveText(
      "0:06.5",
    )
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText("Rally 5 is now 0:06.5–0:08.6")).toBeVisible()

    const fixed = seeded.map((b, i) => (i === 4 ? [6.5, 8.6] : b))
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(fixed)
    // The reel's clips are times in the video: a fix doesn't move them
    expect(await spansOf(token, videoId)).toEqual([
      [0, 2.3],
      [5.8, 9.6],
    ])

    // Undo calls the reverse endpoint
    await undoButton(page).click()
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
    await expect(bar(page)).toHaveText("2 picked")
  })

  test("split into two rallies; the reel stays; undo and redo", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await page.goto(`/videos/${videoId}`)

    await fix(page, 5, "Split into two rallies")
    const dialog = page.getByRole("dialog", { name: "Split rally 5" })
    // The playhead isn't in rally 5: the middle (7.7 s)
    await expect(dialog.getByLabel("Split at", { exact: true })).toHaveText(
      "0:07.7",
    )
    await dialog.getByRole("button", { name: "Split", exact: true }).click()
    await expect(page.getByText("Rally 5 split into 5 and 6")).toBeVisible()
    await expect(rows(page)).toHaveCount(8)
    await expect(page.getByRole("radio", { name: "All 8" })).toBeVisible()
    const split = [
      ...seeded.slice(0, 4),
      [6.8, 7.7],
      [7.7, 8.6],
      ...seeded.slice(5),
    ]
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(split)
    expect(await spansOf(token, videoId)).toEqual([
      [0, 2.3],
      [5.8, 9.6],
    ])

    await undoButton(page).click()
    await expect(rows(page)).toHaveCount(7)
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
    // The clip's label points at the rally that's there now (merging made a new id)
    const rallies = await readRallies(token, videoId)
    await expect
      .poll(
        async () =>
          (await readReel(token, videoId))?.edit.segments.map(
            (c) => c.rally_id,
          ),
        { timeout: SAVE_TIMEOUT },
      )
      .toEqual([rallies[0].id, rallies[4].id])
    await expect(bar(page)).toHaveText("2 picked")

    // Redo (⇧⌘Z here: the Redo button is in Edit's time row)
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.keyboard.press("ControlOrMeta+Shift+z")
    await expect(rows(page)).toHaveCount(8)
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(split)
  })

  test("merge with the next rally; undo", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}`)

    await fix(page, 2, "Merge with next rally")
    await expect(
      page.getByText("Rallies 2 and 3 merged into rally 2"),
    ).toBeVisible()
    await expect(rows(page)).toHaveCount(6)
    await expect
      .poll(() => rallyBounds(token, videoId))
      .toEqual([seeded[0], [2.3, 4.6], ...seeded.slice(3)])

    // The toast's Undo does the same as the time row's
    await page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "Undo" })
      .click()
    await expect(rows(page)).toHaveCount(7)
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
  })

  test("not a rally: delete it; its clip stays, unlabelled; undo", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await page.goto(`/videos/${videoId}`)
    await expect(bar(page)).toHaveText("2 picked")

    await fix(page, 1, "Not a rally, delete it")
    await expect(page.getByText("Rally 1 deleted")).toBeVisible()
    await expect(page.getByText("Its clip stays in your reel.")).toBeVisible()
    await expect(rows(page)).toHaveCount(6)
    await expect(bar(page)).toHaveText("1 picked")
    // Same footage, no rally any more
    await expect
      .poll(
        async () =>
          (await readReel(token, videoId))?.edit.segments.map((c) => [
            c.start,
            c.end,
            c.rally_id === null,
          ]),
        { timeout: SAVE_TIMEOUT },
      )
      .toEqual([
        [0, 2.3, true],
        [5.8, 9.6, false],
      ])

    await undoButton(page).click()
    await expect(rows(page)).toHaveCount(7)
    await expect(bar(page)).toHaveText("2 picked")
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
  })

  test("+ Missed rally adds one at the playhead; undo", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    await page.goto(`/videos/${videoId}`)
    await page.waitForFunction(
      () => (document.querySelector("video")?.readyState ?? 0) >= 1,
    )
    await seekTo(page, 1.5) // between rallies 1 and 2

    await page.getByRole("button", { name: "Add a missed rally here" }).click()
    const dialog = page.getByRole("dialog", { name: "Add a missed rally" })
    // From the playhead to the next rally (2.3 s)
    await expect(dialog.getByLabel("Start", { exact: true })).toHaveText(
      "0:01.5",
    )
    await expect(dialog.getByLabel("End", { exact: true })).toHaveText("0:02.3")
    await dialog.getByRole("button", { name: "Add rally" }).click()
    await expect(page.getByText("Rally 2 added at 0:01.5")).toBeVisible()
    await expect(rows(page)).toHaveCount(8)
    await expect
      .poll(() => rallyBounds(token, videoId))
      .toEqual([seeded[0], [1.5, 2.3], ...seeded.slice(1)])

    await undoButton(page).click()
    await expect(rows(page)).toHaveCount(7)
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
  })
})

// --- Edit mode: timeline -------------------------------------------------------------

/**
 * A click where the element is. Not `locator.click()` on the timeline: Playwright
 * scrolls the element into view first (WebKit even when it's visible), and scrolling
 * the timeline moves the playhead.
 */
async function clickAt(page: Page, target: ReturnType<Page["locator"]>) {
  const box = (await target.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Moves the timeline as a finger would (scrollLeft = x under the playhead). */
const scrollTimeline = (page: Page, x: number) =>
  page.getByTestId("timeline").evaluate((element, left) => {
    element.scrollLeft = left
  }, x)

test.describe("Edit mode timeline", () => {
  test("clips in list order, the + tile; the header sums up the reel", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    await expect(page.getByTestId("clip")).toHaveCount(2)
    await expect(page.getByTestId("clip").nth(1)).toHaveAccessibleName(
      "Clip 2 of 2, 0:03.8",
    )
    await expect(page.getByTestId("reel-summary")).toHaveText("2 clips · 0:06")
    await expect(page.getByTestId("reel-time")).toHaveText("0:00 / 0:06")
    // Highlights says what the match has
    await modes(page).getByRole("radio", { name: "Highlights" }).click()
    await expect(page.getByTestId("match-summary")).toHaveText(
      "7 rallies · 0:06 play",
    )
  })

  test("moving the timeline seeks the video (scroll and mouse drag)", async ({
    page,
  }, testInfo) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)

    // R1 is 2.3 s (13.8 px at 6 px/s), 2 px between clips, so R5 starts at 15.8 px.
    // 22 px (scrollLeft is in whole pixels) = 1.03 s into R5, which starts at 5.8 s
    await scrollTimeline(page, 22)
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(6.83, 1)
    await expect(page.getByTestId("reel-time")).toContainText("0:03 /")
    await expect(page.getByTestId("playhead-time")).toHaveText("0:03.3")
    await expect(page.getByTestId("clip").nth(1)).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    if (testInfo.project.name === "iphone") return // touch: native scrolling only
    // Mouse: click and drag left moves the reel forward (on the ruler: on the
    // clip, the selected one's edge handle is right there)
    const box = (await page.getByTestId("timeline").boundingBox())!
    const y = box.y + 12
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 6, y, { steps: 4 })
    await page.mouse.up()
    // 6 px more = 1 s more of R5
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(7.83, 1)
  })

  test("thumbnails from the sprite sheet on clips and rally rows", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page, { thumbnails: true })
    await reelWithTwoClips(token, videoId)
    const sheet = page.waitForResponse((r) => r.url().includes("sheet_000.jpg"))
    await openEdit(page, videoId)
    expect((await sheet).status()).toBe(200)

    const frame = page.getByTestId("clip").first().getByTestId("thumb").first()
    await expect(frame).toHaveCSS("background-image", /sheet_000\.jpg/)

    // Highlights: each rally row shows its own frame
    await page.getByRole("radio", { name: "Highlights" }).click()
    await expect(rows(page).first().getByTestId("thumb")).toHaveCSS(
      "background-image",
      /sheet_000\.jpg/,
    )
  })
})

// --- Edit mode: the tools --------------------------------------------------------------

test.describe("The tools", () => {
  test("cut at the playhead; slow-mo, Text and Format on one clip", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    // 1.7 s into R5 (5.8 s): 7.5 s in the video
    await scrollTimeline(page, 15.8 + 1.7 * 6)
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(7.5, 1)
    await expect(cutButton(page)).toBeEnabled()
    await cutButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(3)
    // The second part is selected
    await expect(page.getByTestId("clip").nth(2)).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    const slowMo = tools(page).getByRole("button", { name: "Slow-mo" })
    await slowMo.click()
    await expect(slowMo).toHaveAttribute("aria-pressed", "true")
    // Part 2 (2.1 s) plays twice as long: 2.3 + 1.7 + 4.2 = 8.2 s
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:08")

    await tools(page).getByRole("button", { name: "Text" }).click()
    await page.getByLabel("Caption").fill("What a rally")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByTestId("caption-track")).toContainText(
      "What a rally",
    )
    await tools(page).getByRole("button", { name: "Format 16:9" }).click()
    await expect(
      page.getByRole("button", { name: /^Format 9:16/ }).first(),
    ).toBeVisible()

    await expect
      .poll(async () => (await readReel(token, videoId))?.edit, {
        timeout: SAVE_TIMEOUT,
      })
      .toMatchObject({
        format: "9:16",
        segments: [
          { start: 0, end: 2.3, slow_mo: false },
          { start: 5.8, end: 7.5, slow_mo: false },
          { start: 7.5, end: 9.6, slow_mo: true },
        ],
        captions: [{ start: 7.5, end: 9.6, text: "What a rally" }],
      })

    // Delete takes just that clip out; undo puts it back
    await deleteButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(2)
    await undoButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(3)
  })

  test("Cut is off near a clip's edges (both parts at least 0.3 s)", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    // 17 px: 0.2 s into R5 (scrollLeft is in whole pixels)
    await scrollTimeline(page, 17)
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(6, 1)
    await expect(cutButton(page)).toBeDisabled()
  })
})

// --- Preview playback ------------------------------------------------------------------

/** Opens the two-clip reel in Edit mode with the video ready to play. */
async function openForPlayback(page: Page) {
  const { token, videoId } = await setUp(page)
  await reelWithTwoClips(token, videoId)
  await openEdit(page, videoId)
  return { token, videoId }
}

/** Puts the video at `t` (paused) and starts recording its time on every frame. */
async function startAt(page: Page, t: number) {
  await seekTo(page, t)
  await page.evaluate(() => {
    const video = document.querySelector("video")!
    const w = window as unknown as { seen: number[]; recording: boolean }
    w.seen = []
    w.recording = true
    const tick = () => {
      w.seen.push(video.currentTime)
      if (w.recording) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
const seenBetween = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([a, b]) =>
      (window as unknown as { seen: number[] }).seen.filter(
        (t) => t > a && t < b,
      ),
    [from, to],
  )
const play = (page: Page) =>
  page.getByRole("button", { name: "Play", exact: true }).first().click()
const pause = (page: Page) =>
  page.getByRole("button", { name: "Pause", exact: true }).first().click()
const rate = (page: Page) =>
  page.evaluate(() => document.querySelector("video")!.playbackRate)

test.describe("Preview playback", () => {
  test("clips back to back, stops at the end, Play restarts", async ({
    page,
  }) => {
    await openForPlayback(page)
    await startAt(page, 1.8) // in R1 (0-2.3 s)
    await play(page)
    // Jumps 2.3-5.8 s: plain playback would need 3.5 s to get there
    await expect
      .poll(() => videoTimeOf(page), { timeout: 2500 })
      .toBeGreaterThanOrEqual(5.8)
    expect(await seenBetween(page, 2.45, 5.75)).toEqual([])

    // The reel ends with R5 (9.6 s): playback stops there
    await expect
      .poll(
        () => page.evaluate(() => document.querySelector("video")!.paused),
        { timeout: 8000 },
      )
      .toBe(true)
    expect(await videoTimeOf(page)).toBeGreaterThan(9.4)
    expect(await videoTimeOf(page)).toBeLessThan(9.9)
    await expect(page.getByTestId("reel-time")).toHaveText("0:06 / 0:06")

    // Play again: from the top of the reel
    await play(page)
    await expect
      .poll(() => videoTimeOf(page), { timeout: 2000 })
      .toBeLessThan(2.3)
  })

  test("a slow-mo clip plays at half speed, the rest at normal speed", async ({
    page,
  }) => {
    await openForPlayback(page)
    await clickAt(page, page.getByTestId("clip").nth(1))
    await tools(page).getByRole("button", { name: "Slow-mo" }).click()

    await startAt(page, 7) // R5: slow
    await play(page)
    await expect.poll(() => rate(page)).toBe(0.5)
    await expect(page.getByTestId("slow-mo-tag")).toBeVisible()
    await pause(page)

    await startAt(page, 1) // R1: normal
    await play(page)
    await expect.poll(() => rate(page)).toBe(1)
    await pause(page)
  })
})
