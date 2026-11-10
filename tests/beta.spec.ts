import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page, test } from "@playwright/test"

import type { FailureReason, VideoPublic } from "../src/client"

// Phone width, like the other beta-flow tests.
test.use({ viewport: { width: 390, height: 844 } })

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/short-clip.mp4",
)

// --- Upload limits ---------------------------------------------------------------

test.describe("Upload limits", () => {
  test("a file over 2 GB is refused before uploading", async ({ page }) => {
    const uploads: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/videos/"))
        uploads.push(request.url())
    })
    await page.goto("/upload")
    await expect(page.getByText(/up to 2 GB and 60 min/)).toBeVisible()

    // A real 2.5 GB file is too heavy for a test, so drop a small File that reports
    // a large size (the check only reads file.size).
    await page.getByText("Choose a video").evaluate((target) => {
      const file = new File(["x"], "huge-match.mp4", { type: "video/mp4" })
      Object.defineProperty(file, "size", { value: 2_500_000_000 })
      const drop = new Event("drop", { bubbles: true, cancelable: true })
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } })
      target.dispatchEvent(drop)
    })

    const alert = page.getByRole("alert")
    await expect(alert).toContainText("This video is too big")
    await expect(alert).toContainText("It's 2.5 GB; the limit is 2 GB.")
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0)
    expect(uploads).toEqual([])
  })

  for (const [status, detail, title] of [
    [413, "The file is larger than the 2 GB limit", "This video is too big"],
    [
      422,
      "The video is 75.0 minutes long; the limit is 60 minutes",
      "This video is too long",
    ],
    [415, "Unsupported file type .avi", "Not a video we can use"],
  ] as const) {
    test(`shows the backend's ${status} message`, async ({ page }) => {
      await page.route("**/api/v1/videos/", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status, json: { detail } })
          : route.continue(),
      )
      await page.goto("/upload")
      await page.getByTestId("video-file-input").setInputFiles(FIXTURE)
      await page.getByRole("button", { name: "Upload" }).click()

      const alert = page.getByRole("alert")
      await expect(alert).toContainText(title)
      await expect(alert).toContainText(detail)
      // The same file would be refused again: no "Try again".
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
        0,
      )
    })
  }
})

// --- Failure reasons ------------------------------------------------------------------

const FAKE_ID = "00000000-0000-4000-8000-0000000000fa"

function failedVideo(reason: FailureReason): VideoPublic {
  const now = new Date().toISOString()
  return {
    id: FAKE_ID,
    owner_id: "00000000-0000-4000-8000-000000000001",
    filename: "failed-match.mp4",
    status: "failed",
    progress: 0,
    duration: 1284,
    fps: 30,
    width: 1280,
    height: 720,
    court_corners: [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.9, 0.9],
      [0.1, 0.9],
    ],
    created_at: now,
    updated_at: now,
    rally_count: 0,
    play_seconds: 0,
    failure_reason: reason,
    court_out_of_frame: false,
  }
}

/** Serves one failed video (list + detail); POST /process answers with `onProcess`. */
async function mockFailedVideo(
  page: Page,
  reason: FailureReason,
  onProcess: { status: number; json: unknown },
) {
  let video = failedVideo(reason)
  await page.route(/\/api\/v1\/videos\/(\?.*)?$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { data: [video], count: 1 } })
      : route.continue(),
  )
  await page.route(`**/api/v1/videos/${FAKE_ID}`, (route) =>
    route.fulfill({ json: video }),
  )
  await page.route(`**/api/v1/videos/${FAKE_ID}/process`, (route) => {
    if (onProcess.status === 200) video = onProcess.json as VideoPublic
    return route.fulfill(onProcess)
  })
}

test.describe("Failed videos", () => {
  test("row shows the reason; Try again queues it", async ({ page }) => {
    const queued = {
      ...failedVideo("Processing kept stopping on this video"),
      status: "queued" as const,
      failure_reason: null,
    }
    await mockFailedVideo(page, "Processing kept stopping on this video", {
      status: 200,
      json: queued,
    })
    await page.goto("/")
    await expect(page.getByTestId("video-status")).toHaveText(
      "Failed · Kept stopping",
    )
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(page.getByTestId("video-status")).toContainText("Queued")
  })

  test("Court not visible: the row offers Re-mark court", async ({ page }) => {
    await mockFailedVideo(page, "Court not visible", { status: 500, json: {} })
    await page.goto("/")
    await expect(page.getByTestId("video-status")).toHaveText(
      "Failed · Court not visible",
    )
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await page.getByRole("link", { name: "Re-mark court" }).click()
    await page.waitForURL(`/videos/${FAKE_ID}/court`)
  })

  test("video page explains it and shows the backend's refusal", async ({
    page,
  }) => {
    const detail = "You already have 2 videos queued or processing"
    await mockFailedVideo(page, "Couldn't read this video", {
      status: 429,
      json: { detail },
    })
    await page.goto(`/videos/${FAKE_ID}`)
    await expect(
      page.getByText("Analysis failed: Couldn't read this video"),
    ).toBeVisible()
    await expect(page.getByText(/export it again/)).toBeVisible()

    await page.getByRole("button", { name: "Try again" }).click()
    await expect(page.getByRole("alert")).toContainText(detail)
  })
})

// --- Beta tag, feedback, recording tips ---------------------------------------------

test("Beta tag next to the app name", async ({ page }) => {
  await page.goto("/")
  // Phone header: logo, app name, Beta
  await expect(
    page
      .getByText("Rally Analyzer", { exact: true })
      .filter({ visible: true })
      .locator(".."),
  ).toContainText("Beta")
})

test("Profile has a prefilled feedback email", async ({ page }) => {
  await page.goto("/settings")
  const link = page.getByRole("link", { name: "Send feedback" })
  await expect(link).toHaveAttribute(
    "href",
    /^mailto:[^?]+@[^?]+\?subject=Rally%20Analyzer%20beta%20feedback&body=/,
  )
})

test("Recording tips are reachable from Upload", async ({ page }) => {
  await page.goto("/upload")
  await page.getByRole("link", { name: "How to set up your camera" }).click()
  await expect(
    page.getByRole("heading", { name: "How to record a match" }),
  ).toBeVisible()
  for (const tip of [
    "Behind the baseline",
    "As high as possible",
    "Whole court in frame",
  ]) {
    await expect(page.getByRole("heading", { name: tip })).toBeVisible()
  }
  await expect(
    page.getByRole("img", { name: /whole court is in the picture/ }),
  ).toBeVisible()
  await page.getByRole("link", { name: "Upload a match" }).click()
  await page.waitForURL("/upload")
})
