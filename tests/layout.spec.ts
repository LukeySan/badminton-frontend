import { expect, test } from "@playwright/test"

// The desktop layout (sidebar) needs a screen that is wide AND tall (index.css `md`).
for (const { name, viewport, desktop } of [
  {
    name: "phone, portrait",
    viewport: { width: 390, height: 844 },
    desktop: false,
  },
  // Wider than 768 px, but a phone: must not switch to the desktop layout
  {
    name: "phone, landscape",
    viewport: { width: 844, height: 390 },
    desktop: false,
  },
  {
    name: "big phone, landscape",
    viewport: { width: 932, height: 430 },
    desktop: false,
  },
  {
    name: "tablet, landscape",
    viewport: { width: 1024, height: 768 },
    desktop: true,
  },
]) {
  test(`${name}: ${desktop ? "sidebar" : "tab bar"}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Your matches", exact: true }),
    ).toBeVisible()

    const tabBar = page.getByRole("navigation", { name: "Main" })
    const sidebarLink = page
      .locator("[data-slot=sidebar-container]")
      .getByRole("link", { name: "Upload" })
    if (desktop) {
      await expect(sidebarLink).toBeVisible()
      await expect(tabBar).toBeHidden()
    } else {
      await expect(tabBar).toBeVisible()
      await expect(sidebarLink).toBeHidden()
    }
  })
}

// The app is portrait-only on phones: sideways, it asks to turn the phone upright.
test.describe("touch phone", () => {
  test.use({ hasTouch: true, isMobile: true })

  test("landscape shows the rotate message, portrait doesn't", async ({
    page,
  }) => {
    const message = page.getByText("Turn your phone upright")
    await page.setViewportSize({ width: 844, height: 390 })
    await page.goto("/")
    await expect(message).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(message).toBeHidden()
    await expect(
      page.getByRole("heading", { name: "Your matches", exact: true }),
    ).toBeVisible()
  })
})

test("a short desktop window never gets the rotate message", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Your matches", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Turn your phone upright")).toBeHidden()
})
