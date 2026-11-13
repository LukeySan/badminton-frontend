import { createFileRoute, redirect } from "@tanstack/react-router"

// Old highlight links (several reels per video, before the player and the editor
// became one screen): a video has one reel now, on the video's own page.
export const Route = createFileRoute("/_layout/videos/$id/reels/$reelId")({
  validateSearch: (search: Record<string, unknown>): { mode?: "edit" } =>
    search.mode === "edit" ? { mode: "edit" } : {},
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/videos/$id",
      params: { id: params.id },
      search,
      replace: true,
    })
  },
})
