import { expect, type Locator, type Page, test } from "@playwright/test"

import { changedBox, grabFrame, hasFfmpeg } from "./utils/frames"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { center, type Point, tapOn, touch } from "./utils/touch"
import { logInUser } from "./utils/user"
import {
  apiToken,
  createReel,
  deleteVideo,
  downloadExport,
  PLAYABLE_CLIP,
  readRallies,
  reelOf,
  renderExport,
  SEEDED_RALLIES,
  saveReelElsewhere,
  seedAnalysis,
  startExport,
  type TestOverlay,
  uploadVideo,
} from "./utils/videos"

// Overlays (edit list v6): text on the reel's own timeline, drawn on the video where
// the export draws it. Add, edit inline, move (snapping to the centre lines),
// resize (corner handle, pinch), the overlay track (edges, hold and drag), cut,
// delete, undo of each, the 9:16 platform guide, Thai wrapping, and an export whose
// text lands where the preview shows it.
//
// Phone width with touch, in both themes; the iphone project runs it in WebKit.
// Gestures are synthetic touch pointer events (tests/utils/touch.ts).

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

const text = (
  id: string,
  start: number,
  end: number,
  extra: Partial<TestOverlay> = {},
): TestOverlay => ({
  id,
  type: "text",
  start,
  end,
  x: 0.5,
  y: 0.5,
  size: 0.06,
  text: "Wow",
  ...extra,
})

/**
 * A fresh user with the playable clip (12 s), analyzed with SEEDED_RALLIES, and a
 * reel of rallies 3, 5 and 7 (9.4 s):
 *   c3 2.4-5.6 (reel 0-3.2)   c5 5.8-9.6 (reel 3.2-7)   c7 9.6-12 (reel 7-9.4)
 * At the timeline's default zoom (6 px per second) reel time t is at about 6t px.
 */
async function setUp(
  page: Page,
  {
    theme = "dark",
    overlays = [],
    format = "16:9",
  }: {
    theme?: "dark" | "light"
    overlays?: TestOverlay[]
    format?: "16:9" | "9:16"
  } = {},
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
  const ids = (await readRallies(token, videoId)).map((r) => r.id)
  await createReel(token, videoId, {
    version: 6,
    format,
    segments: [
      { id: "c3", start: 2.4, end: 5.6, rally_id: ids[2] },
      { id: "c5", start: 5.8, end: 9.6, rally_id: ids[4] },
      { id: "c7", start: 9.6, end: 12, rally_id: ids[6] },
    ],
    overlays,
  })
  await logInUser(page, email, password)
  await page.goto(`/videos/${videoId}?mode=edit`)
  await expect(page.getByTestId("clip")).toHaveCount(3)
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 1,
  )
  // The export's fonts: boxes are measured with them
  await page.evaluate(() => document.fonts.ready)
  return { token, videoId }
}

const boxes = (page: Page) => page.getByTestId("overlay")
const bars = (page: Page) => page.getByTestId("overlay-bar")
const layer = (page: Page) => page.getByTestId("overlay-layer")
const clipTools = (page: Page) =>
  page.getByRole("toolbar", { name: "Edit tools" })
const textTools = (page: Page) =>
  page.getByRole("toolbar", { name: "Text tools" })
const addText = (page: Page) =>
  clipTools(page).getByRole("button", { name: "Add text at the playhead" })
const undoButton = (page: Page) => page.getByTitle("Undo (⌘Z)")
const hint = (page: Page) => page.getByTestId("selection-hint")
const scrollTimeline = (page: Page, x: number) =>
  page.getByTestId("timeline").evaluate((element, left) => {
    element.scrollLeft = left
  }, x)
const reelTime = (page: Page) => page.getByTestId("reel-time")

/** The server's overlays, once the autosave has caught up. */
async function expectSaved(
  token: string,
  videoId: string,
  expected: Partial<TestOverlay>[],
) {
  await expect
    .poll(async () => (await reelOf(token, videoId)).edit.overlays, {
      timeout: SAVE_TIMEOUT,
    })
    .toEqual(expected.map((o) => expect.objectContaining(o)))
}
const savedOverlays = async (token: string, videoId: string) =>
  (await reelOf(token, videoId)).edit.overlays

/** An element's box in fractions of the video frame (the overlay layer). */
const rectInFrame = (target: Locator) =>
  target.evaluate((element) => {
    const frame = document
      .querySelector("[data-testid='overlay-layer']")!
      .getBoundingClientRect()
    const r = element.getBoundingClientRect()
    return {
      left: (r.left - frame.left) / frame.width,
      right: (r.right - frame.left) / frame.width,
      top: (r.top - frame.top) / frame.height,
      bottom: (r.bottom - frame.top) / frame.height,
    }
  })

/** One finger: down at `from`, moved to `to` in steps, up there. */
async function swipe(
  page: Page,
  target: Locator,
  from: Point,
  to: Point,
  {
    steps = 8,
    beforeUp,
  }: { steps?: number; beforeUp?: () => Promise<void> } = {},
) {
  await touch(page, "pointerdown", [{ id: 1, ...from }], target)
  for (let i = 1; i <= steps; i++)
    await touch(
      page,
      "pointermove",
      [
        {
          id: 1,
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
      ],
      target,
    )
  await beforeUp?.()
  await touch(page, "pointerup", [{ id: 1, ...to }], target)
}

/** Two fingers around `at`, from `from` px apart to `to` px apart. */
async function pinch(page: Page, at: Point, from: number, to: number) {
  const fingers = (gap: number) => [
    { id: 1, x: at.x - gap / 2, y: at.y },
    { id: 2, x: at.x + gap / 2, y: at.y },
  ]
  await touch(page, "pointerdown", fingers(from))
  for (let i = 1; i <= 6; i++)
    await touch(page, "pointermove", fingers(from + ((to - from) * i) / 6))
  await touch(page, "pointerup", fingers(to))
}

/** Two quick taps (a double tap). */
async function doubleTap(page: Page, target: Locator) {
  const { x, y } = await center(target)
  await page.touchscreen.tap(x, y)
  await page.touchscreen.tap(x, y)
}

/** The timeline zoomed all the way in (80 px per second), like a pinch would. */
async function zoomIn(page: Page) {
  const timeline = page.getByTestId("timeline")
  for (let i = 0; i < 3; i++)
    await timeline.evaluate((element) => {
      const box = element.getBoundingClientRect()
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -300,
          ctrlKey: true,
          clientX: box.left + box.width / 2,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  await expect(timeline).toHaveAttribute("data-zoom", "80.00")
}

// --- Adding and editing ---------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`Text adds a text at the playhead, typed on the video; undo removes it (${theme})`, async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page, { theme })
    // 1.5 s into the reel
    await scrollTimeline(page, 9)
    await expect(reelTime(page)).toContainText("0:01 /")

    await addText(page).click()
    const editor = page.getByTestId("overlay-editor")
    await expect(editor).toBeFocused()
    // The text's tools while it's selected
    await expect(textTools(page).getByRole("button")).toHaveText([
      "Edit text",
      "Cut",
      "Delete",
      "Done",
    ])
    await page.keyboard.type("What a rally")
    await page.keyboard.press("Enter")

    await expect(editor).toHaveCount(0)
    await expect(boxes(page)).toHaveCount(1)
    await expect(boxes(page)).toHaveAccessibleName("Text: What a rally")
    await expect(boxes(page)).toHaveAttribute("data-selected", "true")
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page)).toContainText("What a rally")
    // Centred, default size; 3 s from the playhead
    const box = await rectInFrame(boxes(page))
    expect((box.left + box.right) / 2).toBeCloseTo(0.5, 2)
    expect((box.top + box.bottom) / 2).toBeCloseTo(0.5, 2)
    await expectSaved(token, videoId, [
      { type: "text", text: "What a rally", x: 0.5, y: 0.5, size: 0.06 },
    ])
    const [saved] = await savedOverlays(token, videoId)
    expect(saved.start).toBeCloseTo(1.5, 0)
    expect(saved.end - saved.start).toBeCloseTo(3, 5)
    // The text box uses the export's font
    expect(
      await boxes(page).evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Overlay Manrope")

    // One undo step takes it away
    await undoButton(page).click()
    await expect(boxes(page)).toHaveCount(0)
    await expect(bars(page)).toHaveCount(0)
    await expect(clipTools(page)).toBeVisible()
    await expectSaved(token, videoId, [])
  })
}

test("a new text left empty isn't added; the limit of 20 turns Text off with the reason", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    overlays: Array.from({ length: 19 }, (_, i) => text(`o${i + 1}`, 5, 6)),
  })
  await addText(page).click()
  await expect(page.getByTestId("overlay-editor")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("overlay-editor")).toHaveCount(0)
  await expect(clipTools(page)).toBeVisible()
  await expect(undoButton(page)).toBeDisabled()

  // The 20th: then Text is off, and the hint says why
  await addText(page).click()
  await page.keyboard.type("Twenty")
  await page.keyboard.press("Enter")
  await textTools(page).getByRole("button", { name: "Done" }).click()
  await expect(addText(page)).toBeDisabled()
  await expect(hint(page)).toContainText("a reel can have up to 20 texts")
  await expect
    .poll(async () => (await savedOverlays(token, videoId)).length, {
      timeout: SAVE_TIMEOUT,
    })
    .toBe(20)
})

test("double tap edits the text inline; Escape cancels; 80 characters at most; undo", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    overlays: [text("o1", 0, 3)],
  })
  const box = boxes(page)
  await expect(box).toHaveAccessibleName("Text: Wow")

  // A tap selects it; a second tap right after edits it
  await doubleTap(page, box)
  const editor = page.getByTestId("overlay-editor")
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText("Wow")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("Smash of the day")
  await page.keyboard.press("Enter")
  await expect(box).toHaveAccessibleName("Text: Smash of the day")
  await expectSaved(token, videoId, [{ id: "o1", text: "Smash of the day" }])

  // Escape: no change
  await textTools(page).getByRole("button", { name: "Edit text" }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.type(" and more")
  await page.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(box).toHaveAccessibleName("Text: Smash of the day")

  // At most 80 characters
  await textTools(page).getByRole("button", { name: "Edit text" }).click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("x".repeat(90))
  await expect(editor).toHaveText("x".repeat(80))
  await page.keyboard.press("Enter")
  await expectSaved(token, videoId, [{ id: "o1", text: "x".repeat(80) }])

  // Each edit was one undo step
  await undoButton(page).click()
  await expect(box).toHaveAccessibleName("Text: Smash of the day")
  await undoButton(page).click()
  await expect(box).toHaveAccessibleName("Text: Wow")
  await expectSaved(token, videoId, [{ id: "o1", text: "Wow" }])
})

// --- Moving and resizing on the video ------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`drag moves it, snapping to the centre lines, inside the safe margin; undo (${theme})`, async ({
    page,
  }) => {
    const { token, videoId } = await setUp(page, {
      theme,
      overlays: [text("o1", 0, 3, { x: 0.3, y: 0.3 })],
    })
    const box = boxes(page)
    const frame = (await layer(page).boundingBox())!
    const from = await center(box)
    // To 5 px right and 4 px below the frame's centre: close enough to snap
    const to = {
      x: frame.x + frame.width / 2 + 5,
      y: frame.y + frame.height / 2 + 4,
    }
    await swipe(page, box, from, to, {
      beforeUp: async () => {
        await expect(page.getByTestId("snap-guide-x")).toBeVisible()
        await expect(page.getByTestId("snap-guide-y")).toBeVisible()
      },
    })
    await expect(page.getByTestId("snap-guide-x")).toHaveCount(0)
    await expect(box).toHaveAttribute("data-selected", "true")
    await expectSaved(token, videoId, [{ id: "o1", x: 0.5, y: 0.5 }])
    const centred = await rectInFrame(box)
    expect((centred.left + centred.right) / 2).toBeCloseTo(0.5, 2)

    // Far past the left edge: it stops at the safe margin (3% of the frame's
    // height in 16:9, like the export)
    const here = await center(box)
    await swipe(page, box, here, { x: here.x - 400, y: here.y })
    const margin = (0.03 * frame.height) / frame.width
    await expect
      .poll(async () => (await rectInFrame(box)).left)
      .toBeCloseTo(margin, 2)
    await expect
      .poll(async () => (await savedOverlays(token, videoId))[0]?.x, {
        timeout: SAVE_TIMEOUT,
      })
      .toBeLessThan(0.5)

    // One undo step per move
    await undoButton(page).click()
    await expectSaved(token, videoId, [{ id: "o1", x: 0.5, y: 0.5 }])
    await undoButton(page).click()
    await expectSaved(token, videoId, [{ id: "o1", x: 0.3, y: 0.3 }])
  })
}

test("resize: drag the corner, or pinch (0.03 to 0.15); undo", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    overlays: [text("o1", 0, 3, { text: "Big point" })],
  })
  const box = boxes(page)
  await tapOn(page, box)
  await expect(box).toHaveAttribute("data-selected", "true")

  // The corner handle twice as far from the centre: twice the size
  const handle = page.getByTestId("overlay-resize")
  const middle = await center(box)
  const corner = await center(handle)
  await swipe(page, handle, corner, {
    x: corner.x + (corner.x - middle.x),
    y: corner.y + (corner.y - middle.y),
  })
  await expect
    .poll(async () => (await savedOverlays(token, videoId))[0]?.size, {
      timeout: SAVE_TIMEOUT,
    })
    .toBeCloseTo(0.12, 2)
  // Still centred: it grows around its centre
  const grown = await rectInFrame(box)
  expect((grown.left + grown.right) / 2).toBeCloseTo(0.5, 2)

  // Pinch out three times as far: capped at 0.15
  await pinch(page, await center(box), 40, 120)
  await expectSaved(token, videoId, [{ id: "o1", size: 0.15 }])
  // Pinch in to a tenth: at least 0.03
  await pinch(page, await center(box), 120, 12)
  await expectSaved(token, videoId, [{ id: "o1", size: 0.03 }])

  // Font size = size × the frame's height
  const frameHeight = (await layer(page).boundingBox())!.height
  expect(
    await box.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    ),
  ).toBeCloseTo(0.03 * frameHeight, 1)

  for (const size of [0.15, 0.12, 0.06]) {
    await undoButton(page).click()
    await expectSaved(token, videoId, [{ id: "o1", size }])
  }
})

test("a tap on the empty video deselects; a tapped clip brings the clip tools back", async ({
  page,
}) => {
  await setUp(page, { overlays: [text("o1", 0, 3, { y: 0.2 })] })
  await tapOn(page, boxes(page))
  await expect(textTools(page)).toBeVisible()
  await expect(hint(page)).toContainText("double-tap to edit")
  // The clip has no handles while the text is selected
  await expect(page.getByTestId("edge-start")).toHaveCount(0)
  const frame = (await layer(page).boundingBox())!
  await page.touchscreen.tap(
    frame.x + frame.width / 2,
    frame.y + frame.height * 0.8,
  )
  await expect(boxes(page)).not.toHaveAttribute("data-selected", "true")
  await expect(clipTools(page)).toBeVisible()

  await tapOn(page, bars(page))
  await expect(textTools(page)).toBeVisible()
  await expect(bars(page)).toHaveAttribute("aria-pressed", "true")
  const clip = page.getByTestId("clip").first()
  const clipBox = (await clip.boundingBox())!
  await page.touchscreen.tap(clipBox.x + 4, clipBox.y + clipBox.height / 2)
  await expect(clipTools(page)).toBeVisible()
  await expect(page.getByTestId("edge-start")).toHaveCount(1)
})

test("only texts on screen at the playhead show; tapping a bar goes to its text", async ({
  page,
}) => {
  await setUp(page, {
    overlays: [
      text("o1", 0, 2, { text: "First" }),
      text("o2", 4, 6, { text: "Second" }),
    ],
  })
  await expect(boxes(page)).toHaveCount(1)
  await expect(boxes(page)).toHaveAccessibleName("Text: First")
  // Two bars on one lane (they don't overlap)
  await expect(bars(page)).toHaveCount(2)
  await tapOn(page, bars(page).nth(1))
  await expect(boxes(page)).toHaveAccessibleName("Text: Second")
  await expect(boxes(page)).toHaveAttribute("data-selected", "true")
  await expect(reelTime(page)).toContainText("0:04 /")
})

// --- The overlay track --------------------------------------------------------------

test("the bar's pink edges change when it shows (0.1 s, snaps to clip edges); hold and drag moves it; undo", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    overlays: [text("o1", 1, 2)],
  })
  // 80 px per second: the clips are at 0-256, 258-562, 564-756 px
  await zoomIn(page)
  await scrollTimeline(page, 120)
  const bar = bars(page)
  await tapOn(page, bar)
  await expect(bar).toHaveAttribute("aria-pressed", "true")
  const end = page.getByTestId("overlay-edge-end")
  await expect(end).toBeVisible()

  // +24 px = +0.3 s
  const e1 = await center(end)
  await swipe(page, end, e1, { x: e1.x + 24, y: e1.y })
  await expectSaved(token, videoId, [{ id: "o1", start: 1, end: 2.3 }])
  // Near where clips c3 and c5 meet (3.2 s, 256 px; the end is at 184): snapped
  const e2 = await center(end)
  await swipe(
    page,
    end,
    e2,
    { x: e2.x + 66, y: e2.y },
    {
      beforeUp: async () => {
        await expect(page.getByTestId("overlay-drag-label")).toHaveText(
          "0:03.2",
        )
      },
    },
  )
  await expectSaved(token, videoId, [{ id: "o1", start: 1, end: 3.2 }])
  // The start can't get closer than 0.3 s to the end
  const start = page.getByTestId("overlay-edge-start")
  const s1 = await center(start)
  await swipe(page, start, s1, { x: s1.x + 400, y: s1.y })
  await expectSaved(token, videoId, [{ id: "o1", start: 2.9, end: 3.2 }])
  await undoButton(page).click()
  await expectSaved(token, videoId, [{ id: "o1", start: 1, end: 3.2 }])

  // Hold the bar (250 ms), then drag: -1 s, the same length
  const held = await center(bar)
  await touch(page, "pointerdown", [{ id: 1, ...held }], bar)
  await page.waitForTimeout(400)
  for (let i = 1; i <= 8; i++)
    await touch(
      page,
      "pointermove",
      [{ id: 1, x: held.x - 10 * i, y: held.y }],
      bar,
    )
  await expect(hint(page)).toContainText("Drag it to when it should show")
  await touch(page, "pointerup", [{ id: 1, x: held.x - 80, y: held.y }], bar)
  await expectSaved(token, videoId, [{ id: "o1", start: 0, end: 2.2 }])

  for (const [s, e] of [
    [1, 3.2],
    [1, 2.3],
    [1, 2],
  ]) {
    await undoButton(page).click()
    await expectSaved(token, videoId, [{ id: "o1", start: s, end: e }])
  }
})

test("Cut splits the text at the playhead, Delete removes it; undo each", async ({
  page,
}) => {
  const { token, videoId } = await setUp(page, {
    overlays: [text("o1", 0, 3)],
  })
  await scrollTimeline(page, 9)
  await expect(reelTime(page)).toContainText("0:01 /")
  await tapOn(page, boxes(page))
  const cut = textTools(page).getByRole("button", {
    name: "Cut the text at the playhead",
  })
  await expect(cut).toBeEnabled()
  await cut.click()
  await expect(bars(page)).toHaveCount(2)
  // The second part is selected
  await expect(bars(page).nth(1)).toHaveAttribute("aria-pressed", "true")
  await expectSaved(token, videoId, [
    { id: "o1", start: 0, end: 1.5 },
    { id: "o2", start: 1.5, end: 3, text: "Wow" },
  ])

  await textTools(page).getByRole("button", { name: "Delete the text" }).click()
  await expect(bars(page)).toHaveCount(1)
  await expect(clipTools(page)).toBeVisible()
  await expectSaved(token, videoId, [{ id: "o1", start: 0, end: 1.5 }])

  await undoButton(page).click()
  await expect(bars(page)).toHaveCount(2)
  await undoButton(page).click()
  await expect(bars(page)).toHaveCount(1)
  await expectSaved(token, videoId, [{ id: "o1", start: 0, end: 3 }])

  // Near its start, Cut is off (both parts at least 0.3 s)
  await scrollTimeline(page, 1)
  await tapOn(page, boxes(page))
  await expect(cut).toBeDisabled()
})

// --- 9:16 ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`9:16: where TikTok / Reels put their buttons shows while a text is selected (${theme})`, async ({
    page,
  }) => {
    await setUp(page, {
      theme,
      format: "9:16",
      overlays: [text("o1", 0, 3, { y: 0.3 })],
    })
    const guide = page.getByTestId("platform-guide")
    await expect(guide).toHaveCount(0)
    await tapOn(page, boxes(page))
    await expect(guide).toBeVisible()
    await expect(guide).toContainText("TikTok / Reels buttons")
    // A hint only: the text can go there
    const box = boxes(page)
    const frame = (await layer(page).boundingBox())!
    const from = await center(box)
    await swipe(page, box, from, {
      x: frame.x + frame.width * 0.9,
      y: frame.y + frame.height * 0.9,
    })
    const placed = await rectInFrame(box)
    expect(placed.bottom).toBeGreaterThan(0.85)
    await textTools(page).getByRole("button", { name: "Done" }).click()
    await expect(guide).toHaveCount(0)
    // Not in 16:9
    await clipTools(page).getByRole("button", { name: "Format 9:16" }).click()
    // The frame turns 16:9: tap the text once it's in its new place
    await expect
      .poll(async () => {
        const f = (await layer(page).boundingBox())!
        return f.width / f.height
      })
      .toBeCloseTo(16 / 9, 2)
    await expect(async () => {
      const before = await box.boundingBox()
      await page.waitForTimeout(100)
      expect(await box.boundingBox()).toEqual(before)
    }).toPass()
    await tapOn(page, box)
    await expect(box).toHaveAttribute("data-selected", "true")
    await expect(guide).toHaveCount(0)
  })
}

// --- Wrapping ----------------------------------------------------------------------

test("Thai wraps between words like the export; the box is as wide as its widest line", async ({
  page,
}) => {
  const thai = "ตีโต้กันยาวที่สุดในวันนี้ เหนื่อยแต่สนุก"
  await setUp(page, {
    format: "9:16",
    overlays: [text("o1", 0, 3, { text: thai, size: 0.08 })],
  })
  const box = boxes(page)
  // Each line's words, as laid out (a word on two lines would show up in both)
  const layout = await box.evaluate((element) => {
    const words = [...element.querySelectorAll("[data-word]")]
    const lines: { top: number; words: string[] }[] = []
    let widest = 0
    for (const word of words) {
      const rects = [...word.getClientRects()].filter((r) => r.width > 0)
      for (const rect of rects) {
        const line = lines.find(
          (l) => Math.abs(l.top - rect.top) < rect.height / 2,
        )
        if (line) line.words.push(word.textContent ?? "")
        else lines.push({ top: rect.top, words: [word.textContent ?? ""] })
      }
      widest = Math.max(widest, ...rects.map((r) => r.width))
    }
    const style = getComputedStyle(element)
    return {
      lines: lines.sort((a, b) => a.top - b.top).map((l) => l.words),
      boxWidth: element.getBoundingClientRect().width,
      padding: Number.parseFloat(style.paddingLeft) * 2,
      maxWidth: Number.parseFloat(style.maxWidth),
    }
  })
  // It wraps, never inside a word (every word is on exactly one line)
  expect(layout.lines.length).toBeGreaterThan(1)
  const placed = layout.lines.flat()
  expect(placed.join("")).toBe(thai.replace(/ /g, ""))
  expect(new Set(placed).size).toBe(placed.length)
  // The words are Intl.Segmenter's (the shared fixture checks those against PyICU)
  const segmenter = new Intl.Segmenter("th", { granularity: "word" })
  const expected = [...segmenter.segment(thai)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)
  expect(placed).toEqual(expected)
  // Shrunk to its widest line, like the export (not the whole width it may take)
  expect(layout.boxWidth).toBeLessThan(layout.maxWidth - 1)
})

// --- The export --------------------------------------------------------------------

test("the export draws the text where the preview shows it", async ({
  page,
}, testInfo) => {
  test.skip(!hasFfmpeg(), "needs ffmpeg to read the exported MP4's frames")
  test.slow()
  const overlay = text("o1", 0, 3, {
    text: "Rally of the day",
    x: 0.45,
    y: 0.3,
    size: 0.08,
  })
  const { token, videoId } = await setUp(page, { overlays: [overlay] })
  // 1 s into the reel: the text is on
  await scrollTimeline(page, 6)
  await expect(boxes(page)).toHaveCount(1)
  const preview = await rectInFrame(boxes(page))

  // The same reel exported with and without the text: what differs is the box
  const withText = testInfo.outputPath("with-text.mp4")
  const without = testInfo.outputPath("without.mp4")
  const first = await startExport(token, videoId)
  await renderExport(first)
  await downloadExport(token, first, withText)
  await saveReelElsewhere(token, videoId, { overlays: [] })
  const second = await startExport(token, videoId)
  await renderExport(second)
  await downloadExport(token, second, without)

  // 720p 16:9
  const drawn = changedBox(
    grabFrame(withText, 1, 1280, 720),
    grabFrame(without, 1, 1280, 720),
  )
  expect(drawn).toBeDefined()
  testInfo.annotations.push({
    type: "box (fractions of the frame)",
    description: JSON.stringify({ preview, export: drawn }),
  })
  // Within 1% of the frame (13 px of 1280, 4 px of the phone's preview)
  for (const side of ["left", "right", "top", "bottom"] as const)
    expect(Math.abs(drawn![side] - preview[side])).toBeLessThan(0.01)
})
