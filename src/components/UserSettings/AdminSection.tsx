import { Link } from "@tanstack/react-router"
import { ChevronRight, Users } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import useShowAllVideos from "@/hooks/useShowAllVideos"

const row =
  "flex min-h-12 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-secondary"

/**
 * Superusers only (the caller checks). On phones this is the only way to reach the
 * admin page, since the sidebar is hidden there.
 */
export function AdminSection() {
  const { wanted, setWanted } = useShowAllVideos()
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>Admin</CardTitle>
        <CardDescription>Only superusers see this.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-1">
        {/* The whole row is the label, so it's a big tap target for the small switch. */}
        <label htmlFor="show-all-videos" className={`${row} cursor-pointer`}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold">All users' videos</span>
            <span className="text-[13px] text-muted-foreground">
              Show everyone's videos on Matches, not just yours
            </span>
          </span>
          <Switch
            id="show-all-videos"
            checked={wanted}
            onCheckedChange={setWanted}
          />
        </label>
        <Link to="/admin" className={row}>
          <Users className="size-5 text-muted-foreground" />
          <span className="flex-1 text-sm font-bold">Manage users</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </CardContent>
    </Card>
  )
}
