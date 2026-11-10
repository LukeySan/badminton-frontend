import { expect, type Page, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import {
  apiToken,
  deleteVideo,
  PLAYABLE_CLIP,
  uploadVideo,
} from "./utils/videos"

// The player's own full screen (never the browser's native video player). Runs in
// Chromium, desktop WebKit and the iPhone project (playwright.config.ts).

test.use({ storageState: { cookies: [], origins: [] } })

// Two rallies in the 12 s clip; with the player's 1 s padding: 1-4 s and 7-10 s,
// so 4-7 s is a break.
const RALLIES = [
  { id: "00000000-0000-4000-8000-0000000000a1", start: 2, end: 3, duration: 1 },
  { id: "00000000-0000-4000-8000-0000000000a2", start: 8, end: 9, duration: 1 },
]

let cleanup: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

/** A fresh user with the playable clip, presented as analyzed, open in the player. */
async function openPlayer(page: Page, projectName: string) {
  if (projectName === "iphone") {
    // iPhone Safari has no Fullscreen API for normal elements (only <video>): take
    // it away so the iPhone project tests the fixed-layer fallback for real.
    await page.addInitScript(() => {
      const proto = Element.prototype as unknown as Record<string, unknown>
      delete proto.requestFullscreen
      delete proto.webkitRequestFullscreen
      Object.defineProperty(Document.prototype, "fullscreenEnabled", {
        get: () => false,
      })
    })
  }
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = `fullscreen-${Math.random().toString(36).slice(2, 8)}`
  const id = await uploadVideo(token, `${name}.webm`, PLAYABLE_CLIP)
  cleanup = () => deleteVideo(token, id)

  // The worker isn't part of the tests: present the clip as analyzed, with rallies.
  await page.route(`**/api/v1/videos/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        status: "done",
        rally_count: RALLIES.length,
        play_seconds: 2,
      },
    })
  })
  await page.route(`**/api/v1/videos/${id}/rallies`, (route) =>
    route.fulfill({ json: { data: RALLIES, count: RALLIES.length } }),
  )

  await logInUser(page, email, password)
  await page.goto(`/videos/${id}`)
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 1,
  )
  return { id }
}

const videoTime = (page: Page) =>
  page.evaluate(() => document.querySelector("video")!.currentTime)

async function seekTo(page: Page, seconds: number) {
  await page.evaluate(
    (t) =>
      new Promise<void>((resolve) => {
        const video = document.querySelector("video")!
        video.addEventListener("seeked", () => resolve(), { once: true })
        video.currentTime = t
      }),
    seconds,
  )
}

const fullscreenButton = (page: Page) =>
  page.getByRole("button", { name: "Full screen", exact: true })
const layer = (page: Page) => page.getByRole("dialog", { name: /full screen$/ })

test("entering and exiting keeps the time and the same video", async ({
  page,
}, testInfo) => {
  await openPlayer(page, testInfo.project.name)
  const fileUrlRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/file-url")) fileUrlRequests.push(request.url())
  })
  await seekTo(page, 5)
  // Mark the element and count reloads: it must be the same <video>, never reloaded.
  const src = await page.evaluate(() => {
    const video = document.querySelector("video")!
    video.dataset.marker = "original"
    const w = window as unknown as { loadStarts: number }
    w.loadStarts = 0
    video.addEventListener("loadstart", () => {
      w.loadStarts += 1
    })
    return video.currentSrc
  })

  await fullscreenButton(page).click()
  await expect(layer(page)).toBeVisible()
  const inLayer = layer(page).getByTestId("video")
  await expect(inLayer).toHaveAttribute("data-marker", "original")
  expect(await videoTime(page)).toBeCloseTo(5, 1)

  await layer(page).getByRole("button", { name: "Exit full screen" }).click()
  await expect(layer(page)).toHaveCount(0)
  await expect(page.getByTestId("video")).toHaveAttribute(
    "data-marker",
    "original",
  )
  expect(await videoTime(page)).toBeCloseTo(5, 1)
  // Focus goes back to the button that opened it.
  await expect(fullscreenButton(page)).toBeFocused()

  // Playing stays playing through the move.
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await fullscreenButton(page).click()
  await expect(layer(page)).toBeVisible()
  await expect
    .poll(() => videoTime(page), { timeout: 3000 })
    .toBeGreaterThan(5.3)
  expect(
    await page.evaluate(() => document.querySelector("video")!.paused),
  ).toBe(false)

  const after = await page.evaluate(() => ({
    src: document.querySelector("video")!.currentSrc,
    loadStarts: (window as unknown as { loadStarts: number }).loadStarts,
  }))
  expect(after.src).toBe(src)
  expect(after.loadStarts).toBe(0)
  expect(fileUrlRequests).toEqual([]) // the signed URL wasn't asked for again
})

test("overlays and the chapter bar are in full screen", async ({
  page,
}, testInfo) => {
  await openPlayer(page, testInfo.project.name)
  await seekTo(page, 2.5) // inside rally 1
  await fullscreenButton(page).click()

  const fullscreen = layer(page)
  await expect(fullscreen).toBeVisible()
  // Covers the whole viewport
  const box = await fullscreen.boundingBox()
  const viewport = page.viewportSize()!
  expect(box).toMatchObject({ x: 0, y: 0 })
  expect(box!.width).toBeCloseTo(viewport.width, 0)
  expect(box!.height).toBeCloseTo(viewport.height, 0)

  await expect(fullscreen.getByTestId("video")).toBeVisible()
  await expect(fullscreen.getByTestId("current-rally")).toHaveText(
    "Rally 1 of 2",
  )
  await expect(
    fullscreen.getByRole("switch", { name: "Skip breaks" }),
  ).toBeVisible()
  await expect(
    fullscreen.getByRole("slider", { name: "Video position" }),
  ).toBeVisible()
  await expect(fullscreen.getByTestId("chapter")).toHaveCount(2)
  for (const name of [
    "Previous rally",
    "Play",
    "Next rally",
    "Exit full screen",
  ]) {
    await expect(
      fullscreen.getByRole("button", { name, exact: true }),
    ).toBeVisible()
  }
})

test("skip breaks works in full screen (same state as inline)", async ({
  page,
}, testInfo) => {
  await openPlayer(page, testInfo.project.name)
  await fullscreenButton(page).click()
  const fullscreen = layer(page)

  const skip = fullscreen.getByRole("switch", { name: "Skip breaks" })
  await skip.click()
  await expect(skip).toHaveAttribute("aria-checked", "true")

  // Play from just before the break (4-7 s): it must jump to the next rally (7 s)
  // much sooner than plain playback could get there.
  await seekTo(page, 3.6)
  await fullscreen.getByRole("button", { name: "Play", exact: true }).click()
  await expect
    .poll(() => videoTime(page), { timeout: 2500 })
    .toBeGreaterThanOrEqual(7)

  await fullscreen.getByRole("button", { name: "Exit full screen" }).click()
  // The same setting inline
  await expect(
    page.getByRole("switch", { name: "Skip breaks" }),
  ).toHaveAttribute("aria-checked", "true")
})

test("Escape and Back both exit full screen", async ({ page }, testInfo) => {
  const { id } = await openPlayer(page, testInfo.project.name)

  await fullscreenButton(page).click()
  await expect(layer(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(layer(page)).toHaveCount(0)
  await expect(fullscreenButton(page)).toBeFocused()
  await expect(page).toHaveURL(`/videos/${id}`)

  // Back (button or gesture) closes full screen instead of leaving the page.
  await fullscreenButton(page).click()
  await expect(layer(page)).toBeVisible()
  await page.goBack()
  await expect(layer(page)).toHaveCount(0)
  await expect(page).toHaveURL(`/videos/${id}`)
  await expect(page.getByTestId("video")).toBeVisible()
})

test("no horizontal scroll at 390 portrait or 844×390 landscape", async ({
  page,
}, testInfo) => {
  const portrait = { width: 390, height: 844 }
  const landscape = { width: 844, height: 390 }
  await page.setViewportSize(portrait)
  await openPlayer(page, testInfo.project.name)
  const scrollsSideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  const videoFits = async (viewport: { width: number; height: number }) => {
    const video = await layer(page).getByTestId("video").boundingBox()
    expect(video!.width).toBeLessThanOrEqual(viewport.width + 0.5)
    expect(video!.height).toBeLessThanOrEqual(viewport.height + 0.5)
  }
  expect(await scrollsSideways()).toBe(false)

  // Full screen while upright, then the phone turns sideways (the app itself is
  // portrait-only, so that's how you get a landscape video).
  await fullscreenButton(page).click()
  await expect(layer(page)).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
  await videoFits(portrait)

  if (testInfo.project.name === "iphone") {
    // The fixed layer stays open while the phone turns.
    await page.setViewportSize(landscape)
  } else {
    // Desktop browsers are in real full screen, where the window can't be resized:
    // check landscape by entering again at that size.
    await layer(page).getByRole("button", { name: "Exit full screen" }).click()
    await expect(layer(page)).toHaveCount(0)
    await page.setViewportSize(landscape)
    await fullscreenButton(page).click()
  }
  await expect(layer(page)).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
  await videoFits(landscape)
  // In landscape the video fills the height (it's a 16:9 clip on a wider screen)
  const video = await layer(page).getByTestId("video").boundingBox()
  expect(video!.height).toBeCloseTo(landscape.height, 0)
})
