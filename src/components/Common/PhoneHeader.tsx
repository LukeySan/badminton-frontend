import { Link } from "@tanstack/react-router"

import useAuth from "@/hooks/useAuth"
import { getInitials } from "@/utils"
import { Logo } from "./Logo"

/** Phone-only app header: mark + name, and the avatar linking to the profile. */
export function PhoneHeader() {
  const { user } = useAuth()
  return (
    <header className="-mt-0.5 flex items-center justify-between md:hidden">
      <Logo variant="full" asLink={false} />
      <Link
        to="/settings"
        aria-label="Profile"
        className="-mr-1.5 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-[34px] items-center justify-center rounded-full border bg-card text-[13px] font-extrabold text-card-foreground">
          {getInitials(user?.full_name || user?.email || "?")}
        </span>
      </Link>
    </header>
  )
}
