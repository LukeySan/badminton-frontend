import { useSyncExternalStore } from "react"

import useAuth from "./useAuth"

// The superuser's "All users' videos" switch (Profile). It's a per-browser display
// preference, so it lives in localStorage; useSyncExternalStore keeps Home and
// Profile (and other tabs, via the "storage" event) in sync without a context.

const STORAGE_KEY = "show-all-videos"
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

function setShowAllVideos(on: boolean) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "true")
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage blocked: the switch just won't be remembered
  }
  for (const onChange of listeners) onChange()
}

/**
 * `wanted`: the switch position. `all`: what to ask the API for. Only a confirmed
 * superuser sends all=true: anyone else gets a 403, and the app logs out on 403.
 * `all` is undefined while the user is still loading, so the list waits instead of
 * fetching your own videos first and everyone's a moment later.
 */
export default function useShowAllVideos() {
  const { user } = useAuth()
  const wanted = useSyncExternalStore(subscribe, read)
  const all = !wanted
    ? false
    : user === undefined
      ? undefined
      : Boolean(user?.is_superuser)
  return { wanted, all, setWanted: setShowAllVideos }
}
