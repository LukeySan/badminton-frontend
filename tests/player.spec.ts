import { expect, test } from "@playwright/test"

import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import { apiToken, deleteVideo, uploadVideo } from "./utils/videos"

test.use({ storageState: { cookies: [], origins: [] } })

test("full screen has its own controls, including exit", async ({ page }) => {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const id = await uploadVideo(token, "fullscreen-test.mp4")
  // The player only opens for analyzed videos and the worker isn't part of the
  // tests: present the uploaded clip as done.
  await page.route(`**/api/v1/videos/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...(await response.json()), status: "done" },
    })
  })
  await logInUser(page, email, password)
  await page.goto(`/videos/${id}`)
  await expect(page.getByTestId("video")).toBeVisible()

  await page.getByRole("button", { name: "Full screen", exact: true }).click()
  // In full screen only the video box is shown: its controls must be inside it.
  const box = page.locator(":fullscreen")
  await expect(box).toBeVisible()
  for (const control of [
    box.getByRole("button", { name: "Exit full screen" }),
    box.getByRole("button", { name: "Play" }),
    box.getByRole("slider", { name: "Video position" }),
    box.getByRole("switch", { name: "Skip breaks" }),
  ]) {
    await expect(control).toBeVisible()
  }

  await box.getByRole("button", { name: "Exit full screen" }).click()
  await expect(page.locator(":fullscreen")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Full screen", exact: true }),
  ).toBeVisible()

  await deleteVideo(token, id)
})
