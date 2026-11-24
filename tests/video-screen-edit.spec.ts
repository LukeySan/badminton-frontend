import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { center, drag, type Point, tapOn, touch } from "./utils/touch"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  PLAYABLE_CLIP,
  readExports,
  readRallies,
  reelOf,
  renderExport,
  SEEDED_RALLIES,
  seedAnalysis,
  type TestClip,
  uploadVideo,
} from "./utils/videos"

// Editor v2 (Edit mode, edit list v5): a flat list of clips played in list order.
// Edge handles on the selected clip, hold and drag a clip to move it (no mode: the
// clips shrink to thumbnails only during that drag), pinch to zoom, "+" to add footage from anywhere in the match, and undo of each.
// Phone width with touch, in both themes; the iphone project runs it in WebKit.
//
// Touch gestures are synthetic pointer events (pointerType "touch") dispatched on
// the elements: Playwright has taps but no touch drags, and none in WebKit. The
// app's gestures are pointer-based, so this is the same code path a finger takes.
// One pinch also goes through Chromium's real touch input (CDP), with the browser's
// own gesture handling in the loop.

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  hasTouch: true,
})

let cleanup: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

const SAVE_TIMEOUT = 10_000

/**
 * A fresh user with the playable clip (12 s), analyzed with SEEDED_RALLIES, and a
 * reel of rallies 3, 5 and 7 with the app's 1 s padding:
 *   c3 2.4-5.6 (R3 3.4-4.6)   c5 5.8-9.6 (R5 6.8-8.6)   c7 9.6-12 (R7 10.6-11.6)
 */
async function setUp(
  page: Page,
  {
    theme = "dark",
    clips,
  }: { theme?: "dark" | "light"; clips?: (ids: number[]) => TestClip[] } = {},
) {
  await page.addInitScript((t) => {
    localStorage.setItem("vite-ui-theme", t)
  }, theme)
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `video-${Math.random().toString(36).slice(2, 8)}`
  const videoId = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, videoId)
  await seedAnalysis(videoId, SEEDED_RALLIES)
  const rallies = await readRallies(token, videoId)
  const ids = rallies.map((r) => r.id)
  const segments = clips?.(ids) ?? [
    { id: "c3", start: 2.4, end: 5.6, rally_id: ids[2] },
    { id: "c5", start: 5.8, end: 9.6, rally_id: ids[4] },
    { id: "c7", start: 9.6, end: 12, rally_id: ids[6] },
  ]
  await createReel(token, videoId, { version: 6, segments })
  await logInUser(page, email, password)
  // The rallies too (edges snap to them, the drag label measures from them)
  const ralliesLoaded = page.waitForResponse(
    (r) => r.url().includes(`/videos/${videoId}/rallies`) && r.ok(),
  )
  await page.goto(`/videos/${videoId}?mode=edit`)
  await ralliesLoaded
  await expect(page.getByTestId("clip")).toHaveCount(segments.length)
  return { token, videoId, ids }
}

const clips = (page: Page) => page.getByTestId("clip")
/** The timeline's clips by id, in list order. */
const order = (page: Page) =>
  page
    .locator("[data-testid='timeline'] [data-clip-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-clip-id")))
const clip = (page: Page, n: number) => clips(page).nth(n)
const timeline = (page: Page) => page.getByTestId("timeline")
/** The server's clips as [id, start, end], once the autosave has caught up. */
async function expectSaved(
  token: string,
  videoId: string,
  expected: [string, number, number][],
) {
  await expect
    .poll(
      async () =>
        (await reelOf(token, videoId)).edit.segments.map((s) => [
          s.id,
          s.start,
          s.end,
        ]),
      { timeout: SAVE_TIMEOUT },
    )
    .toEqual(expected)
}

// --- Synthetic touch -----------------------------------------------------------------

async function pinch(page: Page, scale: number, at?: Point) {
  const c = at ?? (await center(timeline(page)))
  const fingers = (gap: number) => [
    { id: 1, x: c.x - gap / 2, y: c.y },
    { id: 2, x: c.x + gap / 2, y: c.y },
  ]
  await touch(page, "pointerdown", fingers(60))
  for (let i = 1; i <= 6; i++)
    await touch(page, "pointermove", fingers(60 * (1 + ((scale - 1) * i) / 6)))
  await touch(page, "pointerup", fingers(60 * scale))
}
const zoom = async (page: Page) =>
  Number(await timeline(page).getAttribute("data-zoom"))

// --- Layout -----------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`the clip track: header, "+" tile, tools; no view switch or Lead (${theme})`, async ({
    page,
  }, testInfo) => {
    await setUp(page, { theme })
    // 3.2 + 3.8 + 2.4 s
    await expect(page.getByTestId("reel-summary")).toHaveText("3 clips · 0:09")
    await expect(page.getByTestId("reel-time")).toContainText("/ 0:09")
    await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:03.2")
    await expect(page.getByTestId("add-footage")).toBeVisible()
    // The tools, in order
    await expect(
      page.getByRole("toolbar", { name: "Edit tools" }).getByRole("button"),
    ).toHaveText(["Cut", "Delete", "Slow-mo", "Text", "16:9"])
    // Clips are footage: no rally names (their length where it fits, below), and
    // no rally badge on the video
    await expect(timeline(page)).not.toContainText(/R\d|Rally/)
    await expect(page.getByTestId("current-rally")).toHaveCount(0)
    // What v1 had is gone
    await expect(page.getByText("Rallies only")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Lead/ })).toHaveCount(0)
    await expect(page.getByTestId("gap")).toHaveCount(0)
    // Selected: the clip under the playhead, with its handles
    await expect(clip(page, 0)).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByTestId("edge-start")).toHaveCount(1)
    await expect(page.getByTestId("edge-end")).toHaveCount(1)
    // One screen, no sideways scroll
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await pinch(page, 4)
    // 24 px per second: R5's clip (3.8 s, 91 px) has room for its length
    await expect(clip(page, 1).getByTestId("clip-length")).toHaveText("0:03.8")
    await expect(timeline(page)).not.toContainText(/R\d|Rally/)
    await page.screenshot({
      path: testInfo.outputPath(`edit-${theme}.png`),
    })
  })
}

// --- Edge handles ---------------------------------------------------------------------

test("drag the end out past the rally (label, tint, snap), then in; undo each", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  // Zoomed in so a finger's pixel is a small step: 6 → 36 px per second
  await pinch(page, 6)
  await expect.poll(() => zoom(page)).toBeGreaterThan(30)
  const px = await zoom(page)
  const end = page.getByTestId("edge-end")

  // Out by 1.5 s: past R3's detected end (4.6) + 1 s padding, so 5.6 → 7.1
  const start = await center(end)
  await touch(page, "pointerdown", [{ id: 1, ...start }], end)
  await touch(
    page,
    "pointermove",
    [{ id: 1, x: start.x + 1.5 * px, y: start.y }],
    end,
  )
  await expect(page.getByTestId("drag-label")).toHaveText(
    "+2.5 s past rally end",
  )
  await expect(page.getByTestId("revealed")).toHaveCount(1)
  await expect(page.getByTestId("selection-hint")).toContainText(
    "Revealing footage after the detected end",
  )
  // The video shows the frame under the handle
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("video")?.currentTime ?? 0),
    )
    .toBeCloseTo(7.05, 1)
  await touch(
    page,
    "pointerup",
    [{ id: 1, x: start.x + 1.5 * px, y: start.y }],
    end,
  )
  await expect(page.getByTestId("drag-label")).toHaveCount(0)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:04.7")
  await expectSaved(token, videoId, [
    ["c3", 2.4, 7.1],
    ["c5", 5.8, 9.6],
    ["c7", 9.6, 12],
  ])

  // In, to within a few px of R3's detected end: it snaps there (4.6)
  await drag(page, end, -(7.1 - 4.65) * px)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:02.2")
  await expectSaved(token, videoId, [
    ["c3", 2.4, 4.6],
    ["c5", 5.8, 9.6],
    ["c7", 9.6, 12],
  ])

  // The start, in: 0.1 s steps elsewhere (2.4 → 2.9), at least 0.3 s
  await drag(page, page.getByTestId("edge-start"), 0.5 * px)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:01.7")
  await drag(page, page.getByTestId("edge-start"), 10 * px)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:00.3")

  // One undo step per drag
  const undo = page.getByRole("button", { name: "Undo" })
  await undo.click()
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:01.7")
  await undo.click()
  await undo.click()
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:04.7")
  await undo.click()
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:03.2")
  await expectSaved(token, videoId, [
    ["c3", 2.4, 5.6],
    ["c5", 5.8, 9.6],
    ["c7", 9.6, 12],
  ])
})

test("the start can go anywhere, even before the video's other clips; arrow keys too", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await pinch(page, 6)
  const px = await zoom(page)
  // Select R5 (tap it), then drag its start 3 s out: 5.8 → 2.8, over R3's footage
  await tapOn(page, clip(page, 1))
  await expect(clip(page, 1)).toHaveAttribute("aria-pressed", "true")
  await drag(page, page.getByTestId("edge-start"), -3 * px)
  await expect(clip(page, 1)).toHaveAccessibleName("Clip 2 of 3, 0:06.8")
  // Arrow keys on the focused handle: 0.1 s, Shift 1 s (one undo step each)
  await page.getByTestId("edge-end").focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Shift+ArrowLeft")
  await expectSaved(token, videoId, [
    ["c3", 2.4, 5.6],
    ["c5", 2.8, 8.7],
    ["c7", 9.6, 12],
  ])
})

// --- Reorder ----------------------------------------------------------------------------

test("hold and drag a clip: it all shrinks while dragging, then back, moved clip selected; undo", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await pinch(page, 4)
  const tools = page.getByRole("toolbar", { name: "Edit tools" })
  const first = await center(clip(page, 0))
  await touch(page, "pointerdown", [{ id: 1, ...first }], clip(page, 0))
  // Held (250 ms): every clip a thumbnail, that one lifted under the finger
  const strip = page.getByTestId("reorder")
  await expect(strip).toBeVisible()
  const thumbs = page.getByTestId("reorder-clip")
  await expect(thumbs).toHaveCount(3)
  await expect(thumbs.nth(0)).toHaveAttribute("data-lifted", "true")
  // Lengths, no rally names
  await expect(thumbs).toHaveText(["0:03.2", "0:03.8", "0:02.4"])
  await expect(page.getByTestId("selection-hint")).toContainText(
    "let go. The other clips make room.",
  )
  // No mode: the tools stay as they are
  await expect(tools.getByRole("button")).toHaveText([
    "Cut",
    "Delete",
    "Slow-mo",
    "Text",
    "16:9",
  ])

  // The held clip moves as far as the finger does: two places to the right, past
  // the last one, and the others slide aside to make room
  const pitch =
    (await center(thumbs.nth(1))).x - (await center(thumbs.nth(0))).x
  const leftOf = (n: number) =>
    thumbs.nth(n).evaluate((el) => (el as HTMLElement).style.left)
  const before = await leftOf(1)
  const to = first.x + 2 * pitch + 6
  for (const x of [first.x + 10, first.x + pitch, to])
    await touch(page, "pointermove", [{ id: 1, x, y: first.y }])
  await expect.poll(() => leftOf(1)).not.toBe(before)
  await touch(page, "pointerup", [{ id: 1, x: to, y: first.y }])

  // Released: normal size again, the moved clip selected, one undo step
  await expect(strip).toHaveCount(0)
  await expect.poll(() => order(page)).toEqual(["c5", "c7", "c3"])
  await expect(clip(page, 2)).toHaveAttribute("aria-pressed", "true")
  await expect(clip(page, 2)).toHaveAccessibleName("Clip 3 of 3, 0:03.2")
  await expectSaved(token, videoId, [
    ["c5", 5.8, 9.6],
    ["c7", 9.6, 12],
    ["c3", 2.4, 5.6],
  ])
  await page.getByRole("button", { name: "Undo" }).click()
  await expect.poll(() => order(page)).toEqual(["c3", "c5", "c7"])
  await expectSaved(token, videoId, [
    ["c3", 2.4, 5.6],
    ["c5", 5.8, 9.6],
    ["c7", 9.6, 12],
  ])
})

test("a quick swipe, a tap, or holding without dragging moves nothing", async ({
  page,
}) => {
  await setUp(page)
  await pinch(page, 4)
  // A swipe: moving right away is scrolling, not holding
  const start = await center(clip(page, 1))
  await touch(page, "pointerdown", [{ id: 1, ...start }], clip(page, 1))
  await touch(page, "pointermove", [{ id: 1, x: start.x - 30, y: start.y }])
  await page.waitForTimeout(400)
  await expect(page.getByTestId("reorder")).toHaveCount(0)
  await touch(page, "pointerup", [{ id: 1, x: start.x - 30, y: start.y }])
  // A tap: selects it
  await tapOn(page, clip(page, 1))
  await expect(clip(page, 1)).toHaveAttribute("aria-pressed", "true")
  await page.waitForTimeout(400)
  await expect(page.getByTestId("reorder")).toHaveCount(0)
  // Held and let go where it was
  const held = await center(clip(page, 2))
  await touch(page, "pointerdown", [{ id: 1, ...held }], clip(page, 2))
  await expect(page.getByTestId("reorder")).toBeVisible()
  await touch(page, "pointerup", [{ id: 1, ...held }])
  await expect(page.getByTestId("reorder")).toHaveCount(0)
  await expect(clip(page, 2)).toHaveAttribute("aria-pressed", "true")
  expect(await order(page)).toEqual(["c3", "c5", "c7"])
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled()
})

test("keyboard: Alt + arrows move a focused clip, one undo step each", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await clip(page, 0).focus()
  await page.keyboard.press("Alt+ArrowRight")
  await page.keyboard.press("Alt+ArrowRight")
  await expect.poll(() => order(page)).toEqual(["c5", "c7", "c3"])
  await page.getByRole("button", { name: "Undo" }).click()
  await expect.poll(() => order(page)).toEqual(["c5", "c3", "c7"])
  await expectSaved(token, videoId, [
    ["c5", 5.8, 9.6],
    ["c3", 2.4, 5.6],
    ["c7", 9.6, 12],
  ])
})

test("a reordered reel plays in list order", async ({ page }) => {
  await setUp(page, {
    clips: (ids) => [
      { id: "c7", start: 9.6, end: 12, rally_id: ids[6] },
      { id: "c3", start: 2.4, end: 4, rally_id: ids[2] },
    ],
  })
  const video = page.locator("video")
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1)
  await page.getByRole("button", { name: "Play", exact: true }).click()
  // The first clip runs to the end of the video, then the reel goes back to 2.4
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 8000,
    })
    .toBeLessThan(4.2)
  await expect(clip(page, 1)).toHaveAttribute("aria-pressed", "true")
  // ...and stops after it
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible({
    timeout: 6000,
  })
  await expect(page.getByTestId("reel-time")).toHaveText("0:04 / 0:04")
})

// --- Zoom ---------------------------------------------------------------------------------

test("pinch zooms in and out around the pinch's center", async ({ page }) => {
  await setUp(page)
  expect(await zoom(page)).toBe(6)
  const width = async () => (await clip(page, 1).boundingBox())?.width ?? 0
  const before = await width()
  // The moment under the fingers stays under them
  const target = await center(clip(page, 1))
  await pinch(page, 3, target)
  await expect.poll(() => zoom(page)).toBeCloseTo(18, 0)
  expect(await width()).toBeCloseTo(before * 3, -1)
  const after = await center(clip(page, 1))
  expect(Math.abs(after.x - target.x)).toBeLessThan(4)
  // And out again, never past the limits
  await pinch(page, 0.01)
  await expect.poll(() => zoom(page)).toBe(0.5)
})

test("a real two-finger pinch (Chromium touch input)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium's")
  await setUp(page)
  const cdp = await page.context().newCDPSession(page)
  const c = await center(timeline(page))
  const fingers = (gap: number) => [
    { x: c.x - gap / 2, y: c.y, id: 1 },
    { x: c.x + gap / 2, y: c.y, id: 2 },
  ]
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: fingers(40),
  })
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: fingers(40 + i * 20),
    })
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  await expect.poll(() => zoom(page)).toBeGreaterThan(12)
  // The page itself didn't zoom
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
})

test("ctrl + wheel (a trackpad pinch) zooms on desktop", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "no wheel on a phone")
  await setUp(page)
  const c = await center(timeline(page))
  await page.mouse.move(c.x, c.y)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -100)
  await page.keyboard.up("Control")
  await expect.poll(() => zoom(page)).toBeGreaterThan(6)
})

// --- Add footage ----------------------------------------------------------------------------

test("+ adds footage from anywhere in the match after the playhead's clip; undo", async ({
  page,
}) => {
  const { token, videoId, ids } = await setUp(page)
  // The playhead in the first clip
  await expect(clip(page, 0)).toHaveAttribute("aria-pressed", "true")
  await tapOn(page, page.getByTestId("add-footage"))
  const sheet = page.getByRole("dialog", { name: "Add footage" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId("match-chapter")).toHaveCount(7)
  // Starts right after the playhead's clip (5.6), 5 s long
  await expect(sheet.getByTestId("range-times")).toHaveText("0:05.6 to 0:10.6")
  // Arrow keys on a handle: 0.1 s, Shift 1 s
  await sheet.getByTestId("range-end").focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft")
  await expect(sheet.getByTestId("range-times")).toHaveText("0:05.6 to 0:07.6")
  await expect(sheet.getByTestId("range-where")).toHaveText(
    "0:02 · rallies 4–5",
  )
  // Drag the start handle: the video follows it
  const strip = await sheet.getByTestId("match-strip").boundingBox()
  const perSecond = (strip?.width ?? 0) / 12
  await drag(page, sheet.getByTestId("range-start"), 0.5 * perSecond, 4)
  await expect(sheet.getByTestId("range-times")).toHaveText("0:06.1 to 0:07.6")
  await expect(sheet.getByTestId("range-where")).toHaveText(
    "0:01.5 · in rally 5",
  )
  await sheet.getByRole("button", { name: "Add at playhead" }).click()
  await expect(sheet).toHaveCount(0)

  // After the first clip, selected, labelled with the rally it shows most of
  await expect(clips(page)).toHaveCount(4)
  await expect(clip(page, 1)).toHaveAccessibleName("Clip 2 of 4, 0:01.5")
  await expect(clip(page, 1)).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("reel-summary")).toHaveText("4 clips · 0:11")
  const saved = async () => (await reelOf(token, videoId)).edit.segments
  await expect
    .poll(async () => (await saved()).map((s) => [s.start, s.end, s.rally_id]))
    .toEqual([
      [2.4, 5.6, ids[2]],
      [6.1, 7.6, ids[4]],
      [5.8, 9.6, ids[4]],
      [9.6, 12, ids[6]],
    ])

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(async () => (await saved()).length).toBe(3)
})

test("Cancel adds nothing; footage outside the rallies has no rally", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await tapOn(page, page.getByTestId("add-footage"))
  const sheet = page.getByRole("dialog", { name: "Add footage" })
  await sheet.getByRole("button", { name: "Cancel" }).click()
  await expect(sheet).toHaveCount(0)
  // Closed for good (its overlay fades out a moment longer)
  await expect(page.locator("[data-slot=dialog-overlay]")).toHaveCount(0)
  await expect(clips(page)).toHaveCount(3)
  await tapOn(page, page.getByTestId("add-footage"))
  // 5.6-10.6 → 1.4-2.2: after rally 1 (0.5-1.3), before rally 2 (2.3-2.6)
  const start = sheet.getByTestId("range-start")
  await start.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft")
  await expect(sheet.getByTestId("range-where")).toHaveText(
    "0:09 · rallies 2–6",
  )
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await sheet.getByTestId("range-end").focus()
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowLeft")
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft")
  await expect(sheet.getByTestId("range-times")).toHaveText("0:01.4 to 0:02.2")
  await expect(sheet.getByTestId("range-where")).toHaveText(
    "0:00.8 · between rally 1 and 2",
  )
  await sheet.getByRole("button", { name: "Add at playhead" }).click()
  await expect(clip(page, 1)).toHaveAccessibleName("Clip 2 of 4, 0:00.8")
  await expect
    .poll(async () =>
      (await reelOf(token, videoId)).edit.segments.map((s) => s.rally_id),
    )
    .toContain(null)
})

// --- The other tools ---------------------------------------------------------------------

test("cut at the playhead, slow-mo, delete; undo", async ({ page }) => {
  const { token, videoId } = await setUp(page)
  await pinch(page, 6)
  const px = await zoom(page)
  // Tap 1.6 s into R3's clip (2.4 + 1.6 = 4.0)
  const box = await clip(page, 0).boundingBox()
  if (!box) throw new Error("no clip")
  await page.touchscreen.tap(box.x + 1.6 * px, box.y + box.height / 2)
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("video")?.currentTime ?? 0),
    )
    .toBeCloseTo(4, 0)
  await page
    .getByRole("button", { name: /^Cut clip 1 at the playhead/ })
    .click()
  await expect(clips(page)).toHaveCount(4)
  await expect(clip(page, 0)).toHaveAccessibleName(/^Clip 1 of 4,/)
  await expect(clip(page, 1)).toHaveAccessibleName(/^Clip 2 of 4,/)
  // The second part is selected: slow-mo plays it at half speed (twice as long)
  await expect(clip(page, 1)).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Slow-mo" }).click()
  await expect(clip(page, 1)).toHaveAccessibleName(/, slow-mo, /)
  await expect(page.getByTestId("slow-mo-badge")).toHaveCount(1)
  // Delete the first part
  await tapOn(page, clip(page, 0))
  await page.getByRole("button", { name: /^Delete clip 1/ }).click()
  await expect(clips(page)).toHaveCount(3)
  await expect
    .poll(async () =>
      (await reelOf(token, videoId)).edit.segments.map((s) => [
        s.start,
        s.end,
        s.slow_mo,
      ]),
    )
    .toEqual([
      [expect.any(Number), 5.6, true],
      [5.8, 9.6, false],
      [9.6, 12, false],
    ])
  const undo = page.getByRole("button", { name: "Undo" })
  await undo.click()
  await undo.click()
  await undo.click()
  await expect(clips(page)).toHaveCount(3)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:03.2")
})

// --- Export ---------------------------------------------------------------------------

test("the export is the edited list: order, edges, slow-mo", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page)
  await pinch(page, 6)
  const px = await zoom(page)
  // R3's end 1.5 s out (5.6 → 7.1), then slow-mo on it
  await drag(page, page.getByTestId("edge-end"), 1.5 * px)
  await expect(clip(page, 0)).toHaveAccessibleName("Clip 1 of 3, 0:04.7")
  await page.getByRole("button", { name: "Slow-mo" }).click()
  // R7 to the front (Alt + ← on it, the keyboard's hold and drag)
  await clip(page, 2).focus()
  await page.keyboard.press("Alt+ArrowLeft")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect.poll(() => order(page)).toEqual(["c7", "c3", "c5"])
  // 2.4 + 4.7 × 2 + 3.8 = 15.6 s
  await expect(page.getByTestId("reel-summary")).toHaveText("3 clips · 0:16")

  await page.getByRole("button", { name: "Export", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Export highlight" })
  await expect(
    sheet.getByText("Length", { exact: true }).locator(".."),
  ).toContainText("0:16")
  await sheet.getByRole("button", { name: "Export", exact: true }).click()
  await expect(sheet.getByRole("article")).toHaveCount(1)

  // The export renders the saved list, in this order (Export saves first)
  expect(
    (await reelOf(token, videoId)).edit.segments.map((s) => [
      s.id,
      s.start,
      s.end,
      s.slow_mo,
    ]),
  ).toEqual([
    ["c7", 9.6, 12, false],
    ["c3", 2.4, 7.1, true],
    ["c5", 5.8, 9.6, false],
  ])
  const [created] = await readExports(token, videoId)
  const response = await fetch(
    `${process.env.VITE_API_URL}/api/v1/exports/${created.id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const exported = (await response.json()) as { duration: number }
  expect(exported.duration).toBeCloseTo(15.6, 1)

  // The real MP4 (the worker's renderer) is that long too
  await renderExport(created.id)
  const preview = sheet.getByTestId("export-preview")
  await expect(preview).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() =>
      preview.evaluate((v: HTMLVideoElement) =>
        Number.isFinite(v.duration) ? v.duration : 0,
      ),
    )
    .toBeGreaterThan(15.3)
  expect(
    await preview.evaluate((v: HTMLVideoElement) => v.duration),
  ).toBeLessThan(16)
})
