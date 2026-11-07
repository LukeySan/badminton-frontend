import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { videoQueryOptions } from "@/components/Videos/queries"

export const Route = createFileRoute("/_layout/videos/$id/court")({
  component: MarkCourt,
  head: () => ({
    meta: [
      {
        title: "Mark court - Rally Analyzer",
      },
    ],
  }),
})

// Placeholder: the court-tapping screen (screen 3) is the next part of M4.
function MarkCourt() {
  const { id } = Route.useParams()
  const { data: video } = useQuery(videoQueryOptions(id))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
        <Link to="/">
          <ChevronLeft />
          All videos
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mark the court</h1>
        {video && (
          <p className="break-words text-muted-foreground">{video.filename}</p>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming next</CardTitle>
          <CardDescription>
            Here you'll tap the four court corners on a frame of your video.
            Your upload is saved; you can come back to it from the video list.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
