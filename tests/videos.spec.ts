import { expect, type Page, test } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"
import { apiToken, deleteVideo, uploadVideo, videoStatus } from "./utils/videos"

// Phone width: the tab bar, row menus and dialogs as most users see them.
test.use({ viewport: { width: 390, height: 844 } })

const randomName = () => `e2e-${Math.random().toString(36).slice(2, 9)}`

/** A fresh user with one uploaded video, logged in on `page`. */
async function userWithVideo(page: Page) {
  const email = randomEmail()
  const password = randomPassword()
  await createUser({ email, password })
  const token = await apiToken(email, password)
  const name = randomName()
  const id = await uploadVideo(token, `${name}.mp4`)
  await logInUser(page, email, password)
  return { token, id, name }
}

const openRowMenu = (page: Page, name: string) =>
  page.getByRole("button", { name: `More options for ${name}` }).click()

test.describe("Deleting a video", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("from the row menu removes it from the list", async ({ page }) => {
    const { token, id, name } = await userWithVideo(page)
    await expect(page.getByText(name)).toBeVisible()

    await openRowMenu(page, name)
    await page.getByRole("menuitem", { name: "Delete video" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete this video?" })
    await expect(dialog).toContainText(name)
    await dialog.getByRole("button", { name: "Delete video" }).click()

    await expect(page.getByText(`${name} was deleted`)).toBeVisible()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole("link", { name: new RegExp(name) }),
    ).toHaveCount(0)
    expect(await videoStatus(token, id)).toBe(404)
  })

  test("Cancel keeps the video", async ({ page }) => {
    const { token, id, name } = await userWithVideo(page)

    await openRowMenu(page, name)
    await page.getByRole("menuitem", { name: "Delete video" }).click()
    await page.getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
    expect(await videoStatus(token, id)).toBe(200)
    await deleteVideo(token, id)
  })

  test("shows the backend's message when it refuses", async ({ page }) => {
    const { token, id, name } = await userWithVideo(page)
    // The real 409 needs a video mid-processing (a running worker), so fake the reply.
    const message =
      "The video is being processed; delete it once processing has finished"
    await page.route(`**/api/v1/videos/${id}`, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 409, json: { detail: message } })
        : route.continue(),
    )

    await openRowMenu(page, name)
    await page.getByRole("menuitem", { name: "Delete video" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete this video?" })
    await dialog.getByRole("button", { name: "Delete video" }).click()

    await expect(dialog.getByRole("alert")).toContainText(message)
    await expect(dialog).toBeVisible() // stays open, nothing removed
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
    await deleteVideo(token, id)
  })

  test("from the video screen goes back Home", async ({ page }) => {
    const { token, id, name } = await userWithVideo(page)
    // Only analyzed videos open the video screen; the worker isn't part of these
    // tests, so present the uploaded clip as done (no rallies).
    await page.route(`**/api/v1/videos/${id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      const response = await route.fetch()
      await route.fulfill({
        response,
        json: { ...(await response.json()), status: "done" },
      })
    })

    await page.goto(`/videos/${id}`)
    await expect(page.getByRole("heading", { name })).toBeVisible()
    await page.getByRole("button", { name: "More options" }).click()
    await page.getByRole("menuitem", { name: "Delete video" }).click()
    await page
      .getByRole("dialog", { name: "Delete this video?" })
      .getByRole("button", { name: "Delete video" })
      .click()

    await page.waitForURL("/")
    await expect(
      page.getByRole("heading", { name: "Your matches", exact: true }),
    ).toBeVisible()
    await expect(page.getByText(`${name} was deleted`)).toBeVisible()
    expect(await videoStatus(token, id)).toBe(404)
  })
})

test.describe("Profile admin section", () => {
  test("superuser: Admin link and the all-users switch", async ({ page }) => {
    // Someone else's video: only visible with the switch on.
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    const otherToken = await apiToken(email, password)
    const name = randomName()
    const id = await uploadVideo(otherToken, `${name}.mp4`)

    await page.goto("/")
    await expect(page.getByText(name)).not.toBeVisible()

    const tabBar = page.getByRole("navigation", { name: "Main" })
    await tabBar.getByRole("link", { name: "Profile" }).click()
    await page.getByRole("switch", { name: "All users' videos" }).click()
    await tabBar.getByRole("link", { name: "Matches" }).click()
    await expect(page.getByText(/all users/)).toBeVisible()
    await expect(page.getByText(name)).toBeVisible()

    // Remembered, and switching it off shows only your own videos again.
    await page.reload()
    await expect(page.getByText(name)).toBeVisible()
    await tabBar.getByRole("link", { name: "Profile" }).click()
    await page.getByRole("switch", { name: "All users' videos" }).click()
    await tabBar.getByRole("link", { name: "Matches" }).click()
    await expect(
      page.getByRole("heading", { name: "Your matches", exact: true }),
    ).toBeVisible()
    await expect(page.getByText(name)).not.toBeVisible()

    await tabBar.getByRole("link", { name: "Profile" }).click()
    await page.getByRole("link", { name: "Manage users" }).click()
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()

    await deleteVideo(
      await apiToken(firstSuperuser, firstSuperuserPassword),
      id,
    )
  })

  test.describe("regular user", () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test("has no admin section and never asks for all videos", async ({
      page,
    }) => {
      const email = randomEmail()
      const password = randomPassword()
      await createUser({ email, password })
      // A leftover switch from a superuser on the same browser must not matter
      // (all=true would be a 403, and a 403 logs you out).
      await page.addInitScript(() =>
        localStorage.setItem("show-all-videos", "true"),
      )
      const listRequests: string[] = []
      page.on("request", (request) => {
        if (request.url().includes("/api/v1/videos/?"))
          listRequests.push(request.url())
      })

      await logInUser(page, email, password)
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Profile" })
        .click()
      await expect(page.getByRole("tab", { name: "My profile" })).toBeVisible()
      await expect(page.getByText("Admin", { exact: true })).not.toBeVisible()
      await expect(
        page.getByRole("switch", { name: "All users' videos" }),
      ).toHaveCount(0)
      expect(listRequests.length).toBeGreaterThan(0)
      expect(listRequests.every((url) => !url.includes("all=true"))).toBe(true)
    })
  })
})
