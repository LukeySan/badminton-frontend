import {
  CircleCheck,
  CircleExclamationPoint,
  Clock,
  LoaderCircle,
  MapPin,
} from "lucide-react"

import type { VideoPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import type { VideoStatus } from "./queries"

// `satisfies Record<VideoStatus, …>`: if the backend adds a status and the client is
// regenerated, the build fails here until it gets a label.
const STATUS = {
  uploaded: { label: "Needs court", variant: "outline", Icon: MapPin },
  queued: { label: "Queued", variant: "secondary", Icon: Clock },
  processing: { label: "Analyzing", variant: "secondary", Icon: LoaderCircle },
  done: { label: "Ready", variant: "default", Icon: CircleCheck },
  failed: {
    label: "Failed",
    variant: "destructive",
    Icon: CircleExclamationPoint,
  },
} as const satisfies Record<
  VideoStatus,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
    Icon: typeof MapPin
  }
>

export function VideoStatusBadge({
  video,
}: {
  video: Pick<VideoPublic, "status" | "progress">
}) {
  const { label, variant, Icon } = STATUS[video.status]
  return (
    <Badge variant={variant} data-testid="video-status">
      <Icon className={video.status === "processing" ? "animate-spin" : ""} />
      {label}
      {video.status === "processing" && ` ${Math.round(video.progress * 100)}%`}
    </Badge>
  )
}
