import type { Locator, Page } from "@playwright/test"

// Synthetic touch for the video screen's gestures: pointer events with pointerType
// "touch" dispatched on the elements. Playwright has taps but no touch drags (and
// none in WebKit); the app's gestures are pointer-based, so this is the path a
// finger takes.

export type Point = { x: number; y: number }
export async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error("Not visible")
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** Pointer events of a finger (pointerType "touch") on whatever is under it. */
export async function touch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  points: (Point & { id: number })[],
  target?: Locator,
) {
  const handle = target ? await target.elementHandle() : null
  await page.evaluate(
    ({ type, points, hasTarget, el }) => {
      for (const p of points) {
        const element =
          hasTarget && el ? el : document.elementFromPoint(p.x, p.y)
        element?.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: p.id,
            pointerType: "touch",
            isPrimary: p.id === 1,
            clientX: p.x,
            clientY: p.y,
            button: type === "pointermove" ? -1 : 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        )
      }
    },
    { type, points, hasTarget: Boolean(handle), el: handle },
  )
}
/**
 * A tap where the element is. Not `locator.tap()` / `click()` for things on the
 * timeline: Playwright scrolls them into view first (WebKit even when visible), and
 * scrolling the timeline is moving the playhead.
 */
export async function tapOn(page: Page, target: Locator) {
  const { x, y } = await center(target)
  await page.touchscreen.tap(x, y)
}
/** A finger down on `target`, moved `dx` px in steps, then up. */
export async function drag(page: Page, target: Locator, dx: number, steps = 8) {
  const start = await center(target)
  await touch(page, "pointerdown", [{ id: 1, ...start }], target)
  for (let i = 1; i <= steps; i++)
    await touch(
      page,
      "pointermove",
      [{ id: 1, x: start.x + (dx * i) / steps, y: start.y }],
      target,
    )
  await touch(
    page,
    "pointerup",
    [{ id: 1, x: start.x + dx, y: start.y }],
    target,
  )
}
/** Two fingers on the timeline, spread from 60 px apart to 60 × scale. */
