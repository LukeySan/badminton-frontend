import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Pointer capture that never throws: the pointer may already be gone (lifted
 * between the event and this call, or a synthetic one in tests). Without capture the
 * gesture still works while the pointer stays over the element.
 */
export function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Not an active pointer any more
  }
}
