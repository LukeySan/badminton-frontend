import { expect, type Page } from "@playwright/test"

export async function signUpNewUser(
  page: Page,
  name: string,
  email: string,
  password: string,
) {
  await page.goto("/signup")

  await page.getByTestId("full-name-input").fill(name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Sign Up" }).click()
  // The app goes to /login once the account exists; navigating away ourselves
  // could cancel the sign-up request (it did in WebKit).
  await page.waitForURL("/login")
  await expect(page.getByTestId("email-input")).toBeVisible()
}

export async function logInUser(page: Page, email: string, password: string) {
  await page.goto("/login")

  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
  await expect(
    page.getByRole("heading", { name: "Your matches", exact: true }),
  ).toBeVisible()
}

export async function logOutUser(page: Page) {
  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  // The app navigates to /login itself; a second navigation would race it.
  await page.waitForURL("/login")
  await expect(page.getByTestId("email-input")).toBeVisible()
}
