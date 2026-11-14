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
// and rally fixes. Edit is the reel: empty state with quick starts, timeline, cut /
// delete, slow-mo, loop, lead, preview playback, thumbnails. The reel (one per video)
// is created on the first change and autosaved. Full screen: video-screen-fullscreen.
// Runs at phone width in Chromium, desktop WebKit and the iPhone project.
//
// SEEDED_RALLIES with the default lead (1 s before and after, closer rallies sharing
// the gap between them) give these clip windows, which the times below come from:
//   R1 0-1.8  R2 1.8-3  R3 3-5.1  R4 5.1-6.35  R5 6.35-9  R6 9-10.2  R7 10.2-12

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
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled()
  await expect(page.getByText("Coming soon")).toBeVisible()
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
  expect(reel.edit.clips).toHaveLength(1)

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
  await saveReelElsewhere(token, videoId, { format: "9:16", view: "full" })

  // This tab's change is now based on an old version: the backend refuses it.
  await formatChip(page).click()
  await expect(
    page.getByText("Your reel was changed somewhere else"),
  ).toBeVisible()
  await expect(saveStatus(page)).toHaveText("Saved")
  // The other device's version wins and is what the screen shows now.
  await expect(formatChip(page)).toHaveText("9:16")
  const reel = await reelOf(token, videoId)
  expect(reel.edit).toMatchObject({ format: "9:16", view: "full" })
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
  expect((await readReel(token, videoId))?.edit.clips).toEqual([])
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

  // Our own full screen, with the skip pill and the controls
  await page.getByRole("button", { name: "Full screen", exact: true }).click()
  const layer = page.getByRole("dialog", { name: /full screen$/ })
  await expect(layer).toBeVisible()
  // Edit + Rallies only: the breaks are cut by the edit, so the pill says so
  await expect(layer.getByTestId("breaks-cut")).toBeVisible()
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
          (await readReel(token, videoId))?.edit.clips.map((c) => c.rally_id),
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
      .poll(async () => (await readReel(token, videoId))?.edit.clips.length, {
        timeout: SAVE_TIMEOUT,
      })
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
      .poll(async () => (await readReel(token, videoId))?.edit.clips.length, {
        timeout: SAVE_TIMEOUT,
      })
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
 * A reel with rallies 1 and 5, each its whole window: R1 0-1.8 s, R5 6.35-9 s.
 * Between them (1.8-6.35 s): rallies 2, 3 and 4. After: 9-12 s (rallies 6, 7).
 */
async function reelWithTwoClips(token: string, videoId: string) {
  const rallies = await readRallies(token, videoId)
  await createReel(token, videoId, {
    clips: [
      { rally_id: rallies[0].id, pieces: [{ start: 0, end: 1.8 }] },
      { rally_id: rallies[4].id, pieces: [{ start: 6.35, end: 9 }] },
    ],
  })
}

/** Each clip's pieces as [start, end] pairs, as saved on the server. */
const piecesOf = async (token: string, videoId: string) =>
  (await readReel(token, videoId))?.edit.clips.map((clip) =>
    clip.pieces.map((p) => [p.start, p.end]),
  )

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
    // Saved in match order, each its rally's whole window (rally ± 1 s, shared gaps)
    await expect
      .poll(
        async () =>
          (await readReel(token, videoId))?.edit.clips.map((c) => c.rally_id),
        { timeout: SAVE_TIMEOUT },
      )
      .toEqual([rallies[1].id, rallies[4].id])
    expect(await piecesOf(token, videoId)).toEqual([[[1.8, 3]], [[6.35, 9]]])

    await tapCheck(page, 5)
    await expect(bar(page)).toHaveText("1 picked")
    await undoButton(page).click()
    await expect(bar(page)).toHaveText("2 picked")
    await expect(check(page, 5)).toBeChecked()
  })

  test("filters: picked only, and longest first", async ({ page }) => {
    const { token, videoId, rallies } = await setUp(page)
    await createReel(token, videoId, {
      clips: [rallies[2], rallies[6]].map((r) => ({
        rally_id: r.id,
        pieces: [{ start: r.start, end: r.end }],
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
  test("fix start and end: the backend's refusal shows; the clip follows; undo", async ({
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
    // Its clip grew with it: the window now starts halfway to rally 4 (6.2 s)
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.2, 9]]])

    // Undo calls the reverse endpoint: the rally and the clip are back
    await undoButton(page).click()
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 9]]])
  })

  test("split into two rallies; the reel's clip splits too; undo and redo", async ({
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
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 7.7]], [[7.7, 9]]])

    await undoButton(page).click()
    await expect(rows(page)).toHaveCount(7)
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 9]]])
    // The clip points at the rally that's there now (merging made a new id)
    const rallies = await readRallies(token, videoId)
    expect(
      (await readReel(token, videoId))?.edit.clips.map((c) => c.rally_id),
    ).toEqual([rallies[0].id, rallies[4].id])

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

  test("not a rally: delete it; undo brings it and its clip back", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await page.goto(`/videos/${videoId}`)
    await expect(bar(page)).toHaveText("2 picked")

    await fix(page, 1, "Not a rally, delete it")
    await expect(page.getByText("Rally 1 deleted")).toBeVisible()
    await expect(rows(page)).toHaveCount(6)
    await expect(bar(page)).toHaveText("1 picked")
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[6.35, 9]]])

    await undoButton(page).click()
    await expect(rows(page)).toHaveCount(7)
    await expect(bar(page)).toHaveText("2 picked")
    await expect.poll(() => rallyBounds(token, videoId)).toEqual(seeded)
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 9]]])
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

test.describe("Edit mode timeline", () => {
  test("Rallies only: gaps restore on tap, a restored break hides again", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)

    await expect(page.getByTestId("clip")).toHaveCount(2)
    await expect(page.getByTestId("gap")).toHaveCount(2) // between, and after
    await expect(page.getByTestId("breaks-cut")).toBeVisible()
    await expect(
      page.getByText("Breaks and cut parts are hidden, not deleted."),
    ).toBeVisible()
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:04") // 4.45 s

    // The 4.55 s between the clips comes back: rallies 2-4 faint, breaks between
    await page
      .getByRole("button", { name: "Show 0:04.6 of hidden footage" })
      .click()
    await expect(page.getByTestId("gap")).toHaveCount(1)
    await expect(page.getByTestId("unpicked")).toHaveCount(3)
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:09")
    await expect
      .poll(async () => (await readReel(token, videoId))?.edit.restored_gaps, {
        timeout: SAVE_TIMEOUT,
      })
      .toEqual([{ start: 1.8, end: 6.35 }])

    // Tap a restored break: hidden again
    await page.getByTestId("break").nth(1).click()
    await expect(page.getByTestId("gap")).toHaveCount(2)
    await expect(page.getByTestId("unpicked")).toHaveCount(0)
    await expect
      .poll(async () => (await readReel(token, videoId))?.edit.restored_gaps, {
        timeout: SAVE_TIMEOUT,
      })
      .toEqual([])

    // Undo brings the restored stretch back
    await undoButton(page).click()
    await expect(page.getByTestId("unpicked")).toHaveCount(3)
  })

  test("Full video: everything stays; tap a faint rally to add it", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)

    await page.getByRole("radio", { name: "Full video" }).click()
    await expect(page.getByText("Everything stays.")).toBeVisible()
    await expect(page.getByTestId("gap")).toHaveCount(0)
    await expect(page.getByTestId("unpicked")).toHaveCount(5) // 2, 3, 4, 6, 7
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:12")
    // Full video plays the whole match: the skip-breaks toggle is back
    await expect(
      page.getByRole("switch", { name: "Skip breaks" }),
    ).toBeVisible()
    await expect
      .poll(async () => (await readReel(token, videoId))?.edit.view, {
        timeout: SAVE_TIMEOUT,
      })
      .toBe("full")

    await page
      .getByRole("button", { name: "Rally 3, not in the reel. Tap to add" })
      .click()
    await expect(page.getByTestId("clip")).toHaveCount(3)
    await expect(
      page.getByRole("button", { name: /^Rally 3, /, pressed: true }),
    ).toBeVisible()
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[3, 5.1]], [[6.35, 9]]])

    await page.getByRole("radio", { name: "Rallies only" }).click()
    await expect(page.getByTestId("gap").first()).toBeVisible()
  })

  test("moving the timeline seeks the video (scroll and mouse drag)", async ({
    page,
  }, testInfo) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    const timeline = page.getByTestId("timeline")

    // R1 is 1.8 s (10.8 px), then the 40 px gap marker (no time), then R5 at 54.8 px.
    // 62 px = 1.2 s into R5, which starts at 6.35 s in the video.
    await timeline.evaluate((element) => {
      element.scrollLeft = 62
    })
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(7.55, 1)
    await expect(page.getByTestId("reel-time")).toContainText("0:03 /")
    await expect(page.getByTestId("playhead-time")).toHaveText("0:03")

    if (testInfo.project.name === "iphone") return // touch: native scrolling only
    // Mouse: click and drag left moves the reel forward
    const box = (await timeline.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 6, y, { steps: 4 })
    await page.mouse.up()
    // 6 px more = 1 s more of R5
    await expect.poll(() => videoTimeOf(page)).toBeCloseTo(8.55, 1)
  })

  test("lead-in / lead-out: clips grow and shrink with it; one undo step per tap", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)

    await page
      .getByRole("button", { name: /^Lead-in 1 s, lead-out 1 s/ })
      .click()
    const dialog = page.getByRole("dialog", {
      name: "Before and after each rally",
    })
    for (const name of ["Lead-in shorter", "Lead-out shorter"]) {
      await dialog.getByRole("button", { name }).click()
      await dialog.getByRole("button", { name }).click()
    }
    await expect(
      dialog.getByRole("button", { name: "Lead-in shorter" }),
    ).toBeDisabled()
    await dialog.getByRole("button", { name: "Done" }).click()

    // No lead: each clip is exactly its rally (0.8 s + 1.8 s)
    await expect(
      page.getByRole("button", { name: /^Lead-in 0 s, lead-out 0 s/ }),
    ).toBeVisible()
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:03")
    await expect
      .poll(async () => (await readReel(token, videoId))?.edit, {
        timeout: SAVE_TIMEOUT,
      })
      .toMatchObject({ lead_in: 0, lead_out: 0 })
    expect(await piecesOf(token, videoId)).toEqual([[[0.5, 1.3]], [[6.8, 8.6]]])

    for (let i = 0; i < 4; i++) await undoButton(page).click()
    await expect(
      page.getByRole("button", { name: /^Lead-in 1 s, lead-out 1 s/ }),
    ).toBeVisible()
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 9]]])
  })

  test("thumbnails from the sprite sheet on clips and faint rallies", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page, { thumbnails: true })
    await reelWithTwoClips(token, videoId)
    const sheet = page.waitForResponse((r) => r.url().includes("sheet_000.jpg"))
    await openEdit(page, videoId)
    expect((await sheet).status()).toBe(200)

    const frame = page.getByTestId("clip").first().getByTestId("thumb").first()
    await expect(frame).toHaveCSS("background-image", /sheet_000\.jpg/)
    await page.getByRole("radio", { name: "Full video" }).click()
    await expect(
      page.getByTestId("unpicked").first().getByTestId("thumb").first(),
    ).toHaveCSS("background-image", /sheet_000\.jpg/)

    // Highlights: each rally row shows its own frame
    await page.getByRole("radio", { name: "Highlights" }).click()
    await expect(rows(page).first().getByTestId("thumb")).toHaveCSS(
      "background-image",
      /sheet_000\.jpg/,
    )
  })
})

// --- Edit mode: cut, delete and the tools ----------------------------------------------

test.describe("Cut and the tools", () => {
  test("cut at the playhead, then delete the part you don't want", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    await expect(page.getByTestId("thumb")).toHaveCount(0) // no strip: plain clips

    // The playhead picks the piece; too close to its edge, Cut does nothing
    await seekTo(page, 6.5)
    await expect(hint(page)).toContainText("Rally 5 selected")
    await expect(cutButton(page)).toBeDisabled()

    await seekTo(page, 7.55)
    await cutButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(3)
    await expect(hint(page)).toContainText("Rally 5, part 2 of 2 selected")
    await expect(
      page.getByRole("button", {
        name: /^Rally 5 part 2 of 2, /,
        pressed: true,
      }),
    ).toBeVisible()
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([
        [[0, 1.8]],
        [
          [6.35, 7.55],
          [7.55, 9],
        ],
      ])

    await deleteButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(2)
    await expect(hint(page)).toContainText("Rally 5 selected")
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 7.55]]])

    // Highlights shows how much of the rally this reel keeps
    await page.getByRole("radio", { name: "Highlights" }).click()
    await expect(
      page.locator('li[data-number="5"]').getByTestId("kept"),
    ).toHaveText("0:01.2 kept")

    // Deleting the last piece takes the rally out of the reel; undo puts it back
    await page.getByRole("radio", { name: "Edit", exact: true }).click()
    await deleteButton(page).click()
    await expect(page.getByTestId("clip")).toHaveCount(1)
    await undoButton(page).click()
    await undoButton(page).click()
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([
        [[0, 1.8]],
        [
          [6.35, 7.55],
          [7.55, 9],
        ],
      ])
  })

  test("restore a cut: the stripe in Full video, the gap in Rallies only", async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    const cutAndDelete = async () => {
      await seekTo(page, 7.55)
      await cutButton(page).click()
      await deleteButton(page).click() // the second part, 7.55-9 s
      await expect
        .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
        .toEqual([[[0, 1.8]], [[6.35, 7.55]]])
    }

    await cutAndDelete()
    // Rallies only: the cut part folds into the gap marker
    await expect(page.getByTestId("cut")).toHaveCount(0)
    // Full video: a pink stripe; tapping it merges the pieces back into one
    await page.getByRole("radio", { name: "Full video" }).click()
    const stripe = page.getByRole("button", {
      name: /^Cut part of rally 5, 0:01\.\d\. Tap to put it back$/,
    })
    await stripe.click()
    await expect(page.getByTestId("cut")).toHaveCount(0)
    await expect
      .poll(() => piecesOf(token, videoId), { timeout: SAVE_TIMEOUT })
      .toEqual([[[0, 1.8]], [[6.35, 9]]])

    // Rallies only: the gap brings back the cut part and the break after it
    await page.getByRole("radio", { name: "Rallies only" }).click()
    await cutAndDelete()
    await page
      .getByRole("button", { name: "Show 0:04.5 of hidden footage" }) // 1.45 + 3 s
      .click()
    await expect
      .poll(async () => (await readReel(token, videoId))?.edit, {
        timeout: SAVE_TIMEOUT,
      })
      .toMatchObject({
        clips: [{}, { pieces: [{ start: 6.35, end: 9 }] }],
        restored_gaps: [{ start: 9, end: 12 }],
      })
  })

  test("slow-mo is per piece; Text and Format", async ({ page }) => {
    const { token, videoId } = await setUp(page)
    await reelWithTwoClips(token, videoId)
    await openEdit(page, videoId)
    await seekTo(page, 7.55)
    await cutButton(page).click()
    await seekTo(page, 7)
    await expect(hint(page)).toContainText("Rally 5, part 1 of 2 selected")

    const slowMo = tools(page).getByRole("button", { name: "Slow-mo" })
    await slowMo.click()
    await expect(slowMo).toHaveAttribute("aria-pressed", "true")
    // Part 1 (1.2 s) plays twice as long: 1.8 + 2.4 + 1.45 = 5.65 s
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:06")
    // Part 2 isn't slowed
    await seekTo(page, 8)
    await expect(slowMo).toHaveAttribute("aria-pressed", "false")

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
        clips: [
          { pieces: [{ slow_mo: false }] },
          {
            pieces: [
              { start: 6.35, end: 7.55, slow_mo: true },
              { start: 7.55, end: 9, slow_mo: false },
            ],
          },
        ],
        overlays: { captions: [{ start: 7.55, end: 9, text: "What a rally" }] },
      })
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
  test("Rallies only: clips back to back, stops at the end, Play restarts", async ({
    page,
  }) => {
    await openForPlayback(page)
    await startAt(page, 1.5) // in R1 (0-1.8 s)
    await play(page)
    // Jumps over the cut 1.8-6.35 s: plain playback would need 4.5 s to get there
    await expect
      .poll(() => videoTimeOf(page), { timeout: 2500 })
      .toBeGreaterThanOrEqual(6.35)
    expect(await seenBetween(page, 1.95, 6.3)).toEqual([])

    // The reel ends with R5 (9 s): playback stops there
    await expect
      .poll(
        () => page.evaluate(() => document.querySelector("video")!.paused),
        { timeout: 8000 },
      )
      .toBe(true)
    expect(await videoTimeOf(page)).toBeGreaterThan(8.8)
    expect(await videoTimeOf(page)).toBeLessThan(9.3)

    // Play again: from the top of the reel
    await play(page)
    await expect
      .poll(() => videoTimeOf(page), { timeout: 2000 })
      .toBeLessThan(1.8)
  })

  test("a restored stretch plays through", async ({ page }) => {
    await openForPlayback(page)
    await page
      .getByRole("button", { name: "Show 0:04.6 of hidden footage" })
      .click()
    await startAt(page, 1.5)
    await play(page)
    await expect
      .poll(() => videoTimeOf(page), { timeout: 4000 })
      .toBeGreaterThan(2.6)
    expect((await seenBetween(page, 2.0, 2.6)).length).toBeGreaterThan(0)
  })

  test("Full video: skip breaks jumps the breaks, not the unpicked rallies", async ({
    page,
  }) => {
    await openForPlayback(page)
    await page.getByRole("radio", { name: "Full video" }).click()
    const skip = page.getByRole("switch", { name: "Skip breaks" })
    await skip.click()
    await expect(skip).toHaveAttribute("aria-checked", "true")

    // Rally 2 (2.3-2.6 s, not picked) plays; the break after it (2.6-3.4 s) doesn't
    await startAt(page, 2.35)
    await play(page)
    await expect
      .poll(() => videoTimeOf(page), { timeout: 2000 })
      .toBeGreaterThanOrEqual(3.4)
    expect((await seenBetween(page, 2.36, 2.6)).length).toBeGreaterThan(0)
    expect(await seenBetween(page, 2.75, 3.35)).toEqual([])

    // Skip breaks off: the break plays
    await pause(page)
    await skip.click()
    await startAt(page, 2.5)
    await play(page)
    await expect
      .poll(() => videoTimeOf(page), { timeout: 3000 })
      .toBeGreaterThan(3.1)
    expect((await seenBetween(page, 2.75, 3.1)).length).toBeGreaterThan(0)
  })

  test("a slow-mo piece plays at half speed, the rest at normal speed", async ({
    page,
  }) => {
    await openForPlayback(page)
    await seekTo(page, 7.55)
    await cutButton(page).click()
    await seekTo(page, 7)
    await tools(page).getByRole("button", { name: "Slow-mo" }).click()

    await startAt(page, 7) // part 1 of R5: slow
    await play(page)
    await expect.poll(() => rate(page)).toBe(0.5)
    await expect(page.getByTestId("slow-mo-tag")).toBeVisible()

    await pause(page)
    await startAt(page, 8) // part 2: normal
    await play(page)
    await expect.poll(() => rate(page)).toBe(1)
    await pause(page)
    await startAt(page, 1) // R1
    await play(page)
    await expect.poll(() => rate(page)).toBe(1)
  })

  test("Loop repeats the selected piece", async ({ page }) => {
    await openForPlayback(page)
    await seekTo(page, 7.55)
    await cutButton(page).click() // part 2 (7.55-9 s) selected
    const loop = tools(page).getByRole("button", { name: "Loop" })
    await loop.click()
    await expect(loop).toHaveAttribute("aria-pressed", "true")

    await startAt(page, 8.6)
    await play(page)
    // At its end (9 s) it starts again from 7.55 s, instead of stopping
    await expect
      .poll(() => videoTimeOf(page), { timeout: 3000 })
      .toBeLessThan(8.4)
    expect(await seenBetween(page, 9.15, 20)).toEqual([])
    expect(
      await page.evaluate(() => document.querySelector("video")!.paused),
    ).toBe(false)
  })
})
