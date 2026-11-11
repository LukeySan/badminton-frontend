# DESIGN.md — Rally Analyzer visual design

The single source of truth for how the app looks. Follow it for every screen.
Reference mockups (read their source for exact layout and inline styles; they need the
design tool's runtime, so they won't render on their own):
`docs/design/home-dark.mockup.html`, `home-light`, `player-dark`, `player-light`.
They are plain HTML mockups, not React; rebuild them with our shadcn/ui components.
Their rally data is generated placeholder data (match 5's real totals: 73 rallies,
21:24 long, 5:09 of play) — use real API data in the app.

## Rules (read first)

1. **No hard-coded colors, fonts or radii in components or pages.** Use the theme
   variables below through Tailwind classes (`bg-background`, `text-muted-foreground`,
   `bg-highlight`…). If a color is missing, add a token here and in `src/index.css` first.
2. **Pink means "look here."** `--highlight` (#FF3366) marks only the rally being
   watched and things that need fixing (failed videos, errors). Everything else is
   green or neutral. Never let pink vs green be the only difference: the current
   chapter is also taller, the current row also has an outline.
3. **Restyle through tokens and shared components first**, pages last. Prefer existing
   shadcn components (Button, Badge, Switch, ToggleGroup, ScrollArea, Progress, Card,
   Dialog); add missing ones with the shadcn CLI.
4. **Both themes** must work. Default stays `dark` (ThemeProvider), user can switch.
5. **Phone first** (390 px wide), then desktop. Touch targets at least 44×44 px even
   when the visible icon is small.
6. **Contrast:** body text 4.5:1 minimum. White text on `#399E5A` fails — use ink
   (`#191923`) on that green (`--chapter-foreground`). White on pink fails too (3.5:1):
   destructive buttons/badges use ink (`--destructive-foreground`). Small pink text uses
   `--highlight-text` (never `text-destructive`). `/styleguide` measures every pair.

## Palette

| Name  | Hex       | Role                                                     |
| ----- | --------- | -------------------------------------------------------- |
| Ink   | `#191923` | dark background / light-mode text                        |
| Mint  | `#DEFFF2` | light background / dark-mode text                        |
| Green | `#399E5A` | primary action (dark), chapters, progress, length bars   |
| Court | `#03440C` | video/court areas, featured card, primary action (light) |
| Pink  | `#FF3366` | highlight: current rally, needs-attention                |

Derived shades (already chosen, keep them): dark `#23232F` `#2E2E3B` `#34343F` `#2A2A36`
`#20202B`, text `#9DB8AC` `#B9D1C6`, green text `#7FD69B`, pink text `#FF8FAB`;
light `#FFFFFF` `#EAF7F0` `#D3EEE1` `#BFE6D3` `#C6F0D6`, text `#46574F` `#2F3D36`,
pink text `#C2184A` / `#B0123F`, pink tint `#FFF0F4` `#FFE3EA`.

## Theme tokens (`src/index.css`)

Replace the template's values. Hex is fine in CSS variables.

| Token                                        | Dark (`.dark`)    | Light (`:root`) |
| -------------------------------------------- | ----------------- | --------------- |
| `--background`                               | `#191923`         | `#DEFFF2`       |
| `--foreground`                               | `#DEFFF2`         | `#191923`       |
| `--card` / `--popover`                       | `#23232F`         | `#FFFFFF`       |
| `--card-foreground` / `--popover-foreground` | `#DEFFF2`         | `#191923`       |
| `--primary`                                  | `#399E5A`         | `#03440C`       |
| `--primary-foreground`                       | `#191923`         | `#DEFFF2`       |
| `--secondary`                                | `#2E2E3B`         | `#EAF7F0`       |
| `--secondary-foreground`                     | `#DEFFF2`         | `#191923`       |
| `--muted`                                    | `#2E2E3B`         | `#EAF7F0`       |
| `--muted-foreground`                         | `#9DB8AC`         | `#46574F`       |
| `--subtle-foreground`                        | `#B9D1C6`         | `#2F3D36`       |
| `--accent`                                   | `#03440C`         | `#C6F0D6`       |
| `--accent-foreground`                        | `#DEFFF2`         | `#03440C`       |
| `--destructive`                              | `#FF3366`         | `#FF3366`       |
| `--destructive-foreground`                   | `#191923`         | `#191923`       |
| `--border` / `--input`                       | `#34343F`         | `#BFE6D3`       |
| `--ring`                                     | `#399E5A`         | `#399E5A`       |
| `--radius`                                   | `0.875rem` (14px) | same            |

Custom tokens (add with `@theme inline` mappings so `bg-*` / `text-*` classes work):

| Token                     | Dark                    | Light                 | Use                                                                    |
| ------------------------- | ----------------------- | --------------------- | ---------------------------------------------------------------------- |
| `--court`                 | `#03440C`               | `#03440C`             | video areas, thumbnails, featured card                                 |
| `--court-foreground`      | `#DEFFF2`               | `#DEFFF2`             | mint text on `--court` (featured card)                                 |
| `--court-muted`           | `#B9D1C6`               | `#B9D1C6`             | secondary text on `--court` ("out of 21:24 recorded")                  |
| `--court-accent`          | `#7FD69B`               | `#7FD69B`             | label on `--court` ("Last match")                                      |
| `--court-ink`             | `#191923`               | `#191923`             | ink on court areas: Watch button text, length chip (`bg-court-ink/85`) |
| `--court-line`            | `#399E5A`               | `#399E5A`             | court drawings                                                         |
| `--chapter`               | `#399E5A`               | `#399E5A`             | rally segments, length bars, progress                                  |
| `--chapter-foreground`    | `#191923`               | `#191923`             | ink text on green (skip pill, court handles)                           |
| `--chapter-dim`           | `#34343F`               | `#D3EEE1`             | filtered-out segments                                                  |
| `--track`                 | `#2A2A36`               | `#BFE6D3`             | scrubber / bar backgrounds                                             |
| `--highlight`             | `#FF3366`               | `#FF3366`             | current rally fill, failed badge fill tint                             |
| `--highlight-foreground`  | `#191923`               | `#191923`             | text on pink                                                           |
| `--highlight-text`        | `#FF8FAB`               | `#C2184A`             | small pink text                                                        |
| `--highlight-text-strong` | `#FF8FAB`               | `#B0123F`             | pink text on a pink tint (Failed pill)                                 |
| `--highlight-soft`        | `rgba(255,51,102,0.12)` | `#FFF0F4`             | current row background                                                 |
| `--success-text`          | `#7FD69B`               | `#03440C`             | "Ready", play-time numbers                                             |
| `--success-soft`          | `rgba(57,158,90,0.18)`  | `#C6F0D6`             | "Ready" badge background                                               |
| `--sheet`                 | `#20202B`               | `#FFFFFF`             | bottom sheet behind the rally list                                     |
| `--overlay`               | `rgba(25,25,35,0.75)`   | `rgba(25,25,35,0.45)` | dimmed page behind dialogs and sheets (ink)                            |
| `--letterbox`             | `#000000`               | `#000000`             | full-screen player background and its control gradients                |

`--subtle-foreground` is the softer text between foreground and muted: unselected sort
buttons, rally lengths in the list. `shadow-sheet` (utility in `index.css`) is the light
mode's soft shadow above the bottom sheet, made from `--court`; dark mode has none.

The template's `--sidebar-*` tokens have no colors of their own: they point at the tokens
above (`--sidebar` = `--card`, `--sidebar-accent` = `--secondary`, `--sidebar-primary` =
`--primary`, border/ring the same). The unused `--chart-*` tokens were removed.
A `.light` class forces the light theme on part of a page (like `.dark`); `/styleguide`
uses both to show the themes side by side.

## Typography

- Font: **Manrope** (install `@fontsource-variable/manrope`, bundled so it works
  offline in the iOS app; set it as the Tailwind `--font-sans`).
- Weights: 800 titles/numbers that matter, 700 labels/buttons, 600 secondary, 400-500 body.
- Sizes: page title 26/800 (tracking -0.01em); section title 15/800; body 14; secondary 12-13;
  badge 11/800; stat numbers 20/800; app name 18/800.
- All times and lengths use `tabular-nums`.

## Shape and spacing

- Radius: cards/featured 18px, list items 12-16px, buttons and stat tiles 12-14px,
  pills/badges full. Bottom sheet 22px top corners.
- Page side padding 16px on phone, 24px desktop. 8px spacing grid.
- No heavy shadows; dark mode uses surfaces, light mode at most a soft shadow on the sheet.
- Icons: lucide, 20px in controls (stroke 2), 14px in pills.

## Components

**Status badge** (video list): pill, 22px tall, 11px/800.

- Ready → `bg-success-soft text-success-text` "Ready · 73 rallies"
- Analyzing → "Analyzing 42%" text + 4px progress bar (`bg-track`, fill `bg-chapter`)
- Needs court → outline pill "Mark the court ›"
- Failed → `bg-highlight/16 text-highlight-text-strong` "Failed · Court not visible" (a
  short form of the backend's `failure_reason`, `components/Videos/failure.ts`). Below it
  the one fix that can help: an outline "Re-mark court" (court not visible) or
  "Try again" button, 32px with a 44px touch area

**Video row:** 96×54 court thumbnail (`bg-court` + simple court lines, length in a
`bg-court-ink/85 text-court-foreground` chip bottom-right), title 14/700 (ellipsis), date 12 muted, status badge. Light theme:
each row is a white card; dark: flat rows.

**Featured "Last match" card:** `bg-court text-court-foreground`, 18px radius:
"Last match" (`text-court-accent`), "5:09 of play" (22/800), "out of 21:24 recorded"
(`text-court-muted`), and a **Watch** button `bg-court-foreground text-court-ink`.
Play time = sum of the most recent done video's rally durations.

**Chapter scrubber:** 12px track (`bg-track`, 6px radius), segments `bg-chapter`
(min 2px wide), filtered-out `bg-chapter-dim`, **current** segment `bg-highlight`,
3px taller above and below, min 4px wide. Playhead 4px bar in foreground color with a
2px background-colored ring, 7px taller than the track.

**Full screen (our own, never the browser's video player):** a layer over the whole
viewport (`fixed inset-0`, `bg-letterbox` black), portaled to `<body>`, with OUR player:

- the video centered and as big as fits, keeping its shape (black bars around it);
  overlays that must line up with the picture live in the video frame
- top: gradient (`from-letterbox/75`), the rally badge top-left (stays while playing:
  it says what you're watching), the skip-breaks pill top-right
- bottom: gradient (`from-letterbox/90`), the chapter bar, then the same control row as
  inline (time · previous / play / next) ending in **Exit full screen** where the
  Full screen button was
- always the dark theme (`dark` class on the layer re-points the tokens)
- every bar keeps clear of the notch and home indicator in both orientations:
  `env(safe-area-inset-*)` paddings (`viewport-fit=cover` in index.html)
- controls fade out after 3 s of playback (cursor too) and come back on a tap or mouse
  move; the first tap on the video only shows them; tapping the black bars toggles them
- exit: the button, Escape, or Back (a history entry is pushed on entering); the page
  behind is scroll-locked and `inert`; focus returns to the Full screen button

**Portrait only on phones:** a phone held sideways gets a full-page "Turn your phone
upright" message (phone icon in a `bg-success-soft` tile, 15/800 title, 13px muted
text), not a landscape layout. Full-screen video is the exception.

**Control row (TikTok style):** one slim row, no button backgrounds: current time
left ("4:12 / 21:24", 13px tabular, total muted), centered previous / play-pause /
next as plain filled icons (20px, play 26px) in 44×44 targets, full-screen icon right.

**Skip-breaks pill:** sits on the **video's bottom-right corner** (playback setting,
like "Skip intro"). On: solid `bg-chapter text-chapter-foreground` "✓ Skipping breaks"; off: dark
translucent pill with mint text "Skip breaks". 30px tall inside a 44px target.
Rally badge on the video's top-left: pink pill "Rally 12 of 73".

**Destructive actions:** buttons and badges are solid `bg-destructive
text-destructive-foreground` (ink on pink) in both themes, no darker dark-mode tint.
Error text (form messages, destructive alerts, destructive menu items) is
`text-highlight-text`.

**Overlays:** dialogs and sheets dim the page with `bg-overlay`.

**Video areas:** the player's video box is `bg-court`; messages on top of a video use
`bg-court/90 text-court-foreground`. Court-marking handles: `bg-chapter
text-chapter-foreground` with a `border-court-foreground` ring (visible on any frame);
a mis-tapped corner turns `bg-highlight text-highlight-foreground`; the court outline
and magnifier ring use `--court-line` / `--court-foreground`.

**Buttons, inputs, cards (shared components):** button labels 700; default button
40px tall (like the mockup's Watch button), `size="lg"` 44px for a screen's main
actions and anything tapped on a phone; inputs 40px, `bg-card` (white fields on the mint
page in light mode); `Card` is a plain `bg-card` surface with 18px radius, no border or
shadow, `CardTitle` 15/800, `CardDescription` 13px muted; labels and alert titles 700;
`Progress` = `bg-track` with a `bg-chapter` fill. Icon tiles next to text (upload, recording
tips) are `bg-success-soft text-success-text`. Text links: 700 `text-success-text`,
underlined. `Switch`: 24×40px, off = `bg-muted-foreground` track with a `bg-background`
thumb, on = `bg-primary` with a `bg-primary-foreground` thumb (the pale `--input` track
was invisible on white cards); put it in a row-sized `<label>` for a big tap target.

**Video menu (⋮):** 44px ghost icon button, on each video row (beside the row's link,
never inside it) and in the player header. "Delete video" is a destructive menu item;
it opens a confirm dialog whose action is a destructive button (ink on pink) and whose
errors (the backend's message) show in a destructive alert inside the dialog.

**Beta tag:** after the app name, `bg-success-soft text-success-text`, 18px pill,
10px/800 uppercase. Green, not pink: it's information, not something to fix.

**Small pieces:** avatar = round `bg-card border text-card-foreground`, 13/800 initials
(as in the mockups); admin status dot `bg-chapter` (active) / `bg-muted-foreground`
(inactive); the login page's logo panel `bg-muted`.

**Stat strip:** three tiles (This rally / Actual play / Breaks cut), tile `bg-card`,
label 11/700 muted, value 20/800; "Actual play" value in `text-success-text`.

**Rally list:** bottom sheet (`bg-sheet shadow-sheet`, 22px top radius) with sort ToggleGroup
(Time / Longest; selected = foreground fill) and length filter pills (All / 5s+ / 10s+;
selected = green outline + soft fill), a count line, then rows 50px:
`#12 · start time · length bar · 4.2s`. Length bar 8px, width = length ÷ longest rally,
`bg-chapter`. Current row: `bg-highlight-soft`, 1.5px `--highlight` outline, number in
`text-highlight-text`, bar in `bg-highlight`.

**Navigation:** phones get a **bottom tab bar** (76px, top border): Matches, a raised
52px rounded-square **Upload** button in `bg-primary`, Profile. Desktop (`md`) keeps
the template's sidebar, restyled with the tokens. `md` means **at least 768px wide AND
480px tall** (overridden in `index.css`, same query in `useMobile.ts`): a phone held
sideways is wide but short, so it keeps the phone layout.

## Screens

- **Home / Matches** (`/`): header (logo mark + "Rally Analyzer", avatar), "Your matches"
  - summary line, featured Last match card, "Recent" + filters (All / Ready / To do),
    video rows, bottom tab bar. See `home-*.mockup.html`.
- **Player** (`/videos/$id` when done): header (back, title, "21:24 · 73 rallies", more),
  video with rally badge + skip pill, scrubber, control row, stat strip, rally list sheet.
  See `player-*.mockup.html`.
- **Highlight editor** (`/videos/$id/reels/$reelId`): see `EditorHighlights` /
  `EditorEdit` / `EditorFull.dc.html` (one template; they differ only in the starting
  mode and view). Phones: one screen (`h-dvh`), the top half stays, the bottom half
  scrolls by itself.
  - Top half: header (back to the match, reel title, "6 rallies · 1:24 · Saved", Export
    disabled with "Coming soon" under it), the video (max 40% of the screen; "Rally 19"
    badge without "of N"; a 9:16 reel shows the middle of the footage), time row (time ·
    play · undo · redo · format chip · full screen; 44px targets, so play sits right of
    the time instead of centered as in the prototype), Highlights | Edit tabs (`bg-card`
    track, selected = foreground fill).
  - Highlights: filter chips (All 73 / Picked 6 / Longest = longest first), rally rows
    (round check in a 44px target: `bg-chapter` filled when picked, `border-muted-
    foreground` ring when not; 72×40 court thumbnail with the length; "Rally 19" 14/700,
    "at 7:48" 12 muted; "Longest" tag `bg-success-soft`, "Playing" tag on the current row
    `bg-highlight/16 text-highlight-text-strong`), current row = `bg-card` + 2px pink
    inset ring, 14px radius. Bottom bar (top border `border-track`): "6 picked" 14/800,
    "1:24 reel" 12 muted, **Edit reel ›** (foreground fill, 44px).
  - Edit: "Rallies only | Full video" (radio pills in a bordered track, selected =
    `bg-chapter text-chapter-foreground`) with the hint next to it (11px muted). The
    timeline: fixed center playhead (2px foreground, ringed), native horizontal scroll
    (mouse: click and drag), 6 px per second of reel time, 2px between items. Ruler ticks
    every 10 s (Rallies only) / 60 s (Full video), 10px muted. Clip track 60px: clips
    `bg-court` with faint `--chapter` stripes and an "R19 · 0:09" chip
    (`bg-court-ink/85`), selected clip = 2px pink inset ring; collapsed gap = 40px
    `bg-sheet` marker with a ⟷ icon and the hidden length; breaks striped
    (`--card`/`--secondary`), "Break 0:35"; unpicked rallies `bg-court/45` with a
    `--chapter` ring, "R7" and "+ add". In Edit + Rallies only the video's pill is a
    static "✓ Breaks cut" (`text-court-accent`, `--chapter` border), elsewhere the skip
    toggle. The time row shows reel time ("0:12 / 1:24").
  - Selected clip: pink trim handles (12px `bg-highlight`, ink grip) on its edges,
    inside the clip when it's at least 40px wide, outside it (like brackets) when it's
    narrower. Drag (snaps to 0.1 s, stops at the neighbors and the video's ends, 0.5 s
    minimum) or ←/→ when focused. Below the timeline: "**Rally 19** selected · drag the
    pink edges to trim" (12px muted, the rally in `text-highlight-text`), then the tool
    row (72×64 tiles, 14px radius, `bg-card`; active = `bg-success-soft
    text-success-text` with a 1.5px `--chapter` ring): Trim (opens Start/End −/+ rows),
    Slow-mo, Trail, Text (caption dialog, 80 characters), Format, Remove. Overlay
    tracks under the clip track: "Shuttle trail" (`bg-success-soft`) across the reel,
    caption bars "Aa …" (`bg-secondary`) under their clips. On the video: "Slow-mo" tag
    top-right and the caption bottom center (`bg-court-ink/75`).
  - "Make a highlight" sits in the player header (clapperboard icon; "Highlight" on
    phones).
- **How to record** (`/recording-tips`, linked from Upload and Profile): side-view and
  camera-view drawings on `bg-court` (court lines `--court-line`, labels
  `--court-foreground`, sight lines `--court-accent`), good/bad captions in
  `text-success-text` / `text-highlight-text`, then the tips as numbered cards.
- **Upload, Mark court, Processing, login/signup/password pages:** not mocked — they use
  the same tokens, type and shared components (page title 26/800, 13px muted subtitle,
  cards, 44px main buttons, progress) so they match.

## Desktop

Same tokens. Player: video + scrubber + controls on the left, rally list as a right-hand
panel (as built in M5). Home: video rows in a wider list or 2-column grid; featured card
spans the top.
