import { createFileRoute, Link } from "@tanstack/react-router"
import { Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { VideoList } from "@/components/Videos/VideoList"

export const Route = createFileRoute("/_layout/")({
  component: Videos,
  head: () => ({
    meta: [
      {
        title: "Videos - Rally Analyzer",
      },
    ],
  }),
})

function Videos() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Videos</h1>
          <p className="text-muted-foreground">
            Your matches, split into rallies
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link to="/upload">
            <Upload />
            Upload video
          </Link>
        </Button>
      </div>
      <VideoList />
    </div>
  )
}
