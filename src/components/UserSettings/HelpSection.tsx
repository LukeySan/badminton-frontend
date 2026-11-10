import { Link } from "@tanstack/react-router"
import { ChevronRight, Lightbulb, Mail } from "lucide-react"

import { BetaTag } from "@/components/Common/Logo"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import useAuth from "@/hooks/useAuth"

const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL

const row =
  "flex min-h-12 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Prefilled email: the details at the bottom (browser, account) save a round trip
 * when someone reports a problem. A mailto link is enough for the beta; a feedback
 * form with screenshots can come later.
 */
function feedbackHref(email: string | undefined) {
  const body = [
    "",
    "",
    "---",
    `Account: ${email ?? "unknown"}`,
    `Page: ${window.location.pathname}`,
    `Browser: ${navigator.userAgent}`,
  ].join("\n")
  const params = new URLSearchParams({
    subject: "Rally Analyzer beta feedback",
    body,
  })
  // URLSearchParams encodes spaces as "+", which mail apps show literally.
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`
}

export function HelpSection() {
  const { user } = useAuth()
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2">
          Help <BetaTag />
        </CardTitle>
        <CardDescription>
          Rally Analyzer is in beta. Tell us what works and what doesn't.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-1">
        {FEEDBACK_EMAIL && (
          <a href={feedbackHref(user?.email)} className={row}>
            <Mail className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-bold">Send feedback</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </a>
        )}
        <Link to="/recording-tips" className={row}>
          <Lightbulb className="size-5 text-muted-foreground" />
          <span className="flex-1 text-sm font-bold">
            How to record a match
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </CardContent>
    </Card>
  )
}
