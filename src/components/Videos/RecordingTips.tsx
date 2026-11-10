import { Link } from "@tanstack/react-router"
import {
  ArrowUp,
  ChevronRight,
  Fullscreen,
  Hand,
  MapPin,
  Smartphone,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** One list for the Upload card (`text`) and the tips screen (`detail`). */
export const TIPS = [
  {
    Icon: MapPin,
    title: "Behind the baseline",
    text: "Phone on a tripod behind one baseline, facing down the court.",
    detail:
      "Put the tripod a few steps behind one baseline, in the middle, so the phone looks straight down the court.",
  },
  {
    Icon: ArrowUp,
    title: "As high as possible",
    text: "A higher camera sees the shuttle over the net and the players.",
    detail:
      "Raise the tripod all the way, or stand it on a bench or a balcony. From higher up, players hide less of the far court and the shuttle stays visible above the net.",
  },
  {
    Icon: Smartphone,
    title: "Landscape",
    text: "Turn the phone sideways so the whole width of the court fits.",
    detail:
      "Turn the phone sideways before you press record, so the full width of the court fits.",
  },
  {
    Icon: Fullscreen,
    title: "Whole court in frame",
    text: "Both baselines and all four corners visible. A cut-off court gives less accurate rallies.",
    detail:
      "Check the picture before you start: both baselines and all four corners should be visible. A cut-off court makes the rallies less accurate.",
  },
  {
    Icon: Hand,
    title: "Keep it still",
    text: "Don't move or zoom the phone while recording.",
    detail:
      "Don't move, turn or zoom the phone during the match: the court corners you mark apply to the whole video.",
  },
]

/** Short version next to the upload form, with a link to the full screen. */
export function RecordingTips() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording tips</CardTitle>
        <CardDescription>For the most accurate rallies</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-4">
          {TIPS.slice(0, 4).map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-success-soft text-success-text">
                <Icon className="size-4" />
              </div>
              <div>
                <p className="text-sm font-bold">{title}</p>
                <p className="text-[13px] text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link
          to="/recording-tips"
          className="-mx-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold text-success-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          How to set up your camera
          <ChevronRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
