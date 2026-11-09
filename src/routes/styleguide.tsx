import { createFileRoute, Link } from "@tanstack/react-router"

import { Appearance } from "@/components/Common/Appearance"
import { ComponentGallery } from "@/components/Styleguide/ComponentGallery"
import {
  ContrastChecks,
  RadiusScale,
  TokenSwatches,
  TokensInUse,
  TypeScale,
} from "@/components/Styleguide/TokenSections"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Dev reference for DESIGN.md: every shadcn component and token, in both themes at
// once. Public (no API calls) and not linked from the app.
export const Route = createFileRoute("/styleguide")({
  component: Styleguide,
  head: () => ({
    meta: [
      {
        title: "Styleguide - Rally Analyzer",
      },
    ],
  }),
})

function Styleguide() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">
            Styleguide
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Theme tokens and every shadcn/ui component from DESIGN.md, in both
            themes. Tooltips, menus, dialogs, sheets and toasts open outside the
            panels, so they follow the app's theme: switch it here to check
            them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Appearance />
          <Button variant="outline" asChild>
            <Link to="/">Back to app</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <ThemePanel theme="dark" />
        <ThemePanel theme="light" />
      </div>
    </div>
  )
}

/** Forces one theme on its contents: `.dark` / `.light` redefine the tokens. */
function ThemePanel({ theme }: { theme: "dark" | "light" }) {
  return (
    <section
      data-testid={`panel-${theme}`}
      className={cn(
        theme,
        "flex min-w-0 flex-col gap-8 rounded-xl border bg-background p-4 text-foreground sm:p-6",
      )}
    >
      <h2 className="text-[18px] font-extrabold">
        {theme === "dark" ? "Dark (default)" : "Light"}
      </h2>
      <TokenSwatches />
      <ContrastChecks />
      <TypeScale />
      <RadiusScale />
      <TokensInUse />
      <ComponentGallery />
    </section>
  )
}
