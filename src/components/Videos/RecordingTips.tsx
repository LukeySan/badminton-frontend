import { ArrowUp, Fullscreen, MapPin, Smartphone } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const TIPS = [
  {
    Icon: MapPin,
    title: "Behind the baseline",
    text: "Phone on a tripod behind one baseline, facing down the court.",
  },
  {
    Icon: ArrowUp,
    title: "As high as possible",
    text: "A higher camera sees the shuttle over the net and the players.",
  },
  {
    Icon: Smartphone,
    title: "Landscape",
    text: "Turn the phone sideways so the whole width of the court fits.",
  },
  {
    Icon: Fullscreen,
    title: "Whole court in frame",
    text: "Both baselines and all four corners visible. A cut-off court gives less accurate rallies.",
  },
]

export function RecordingTips() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording tips</CardTitle>
        <CardDescription>For the most accurate rallies</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {TIPS.map(({ Icon, title, text }) => (
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
      </CardContent>
    </Card>
  )
}
