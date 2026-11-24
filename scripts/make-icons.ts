// Draws the app icon and splash screen from the app mark (AppIcons.tsx: RallyBarsIcon
// on the court green), for the iOS app and "Add to Home Screen". Run after changing
// the mark or the colors:  bun scripts/make-icons.ts
//
// Colors are DESIGN.md tokens (images can't read CSS variables): --court and
// --court-foreground for the mark (the same in both themes), the dark theme's
// --background for the splash (the default theme).

import { mkdir } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

const COURT = "#03440c"
const COURT_FOREGROUND = "#defff2"
const DARK_BACKGROUND = "#191923"

const root = path.resolve(import.meta.dirname, "..")
const publicIcons = path.join(root, "public/icons")
const xcassets = path.join(root, "ios/App/App/Assets.xcassets")

/** The bars (RallyBarsIcon's paths, 24×24, stroke 2.4), as wide as `glyph` of the box. */
function bars(size: number, glyph: number) {
  const scale = (size * glyph) / 24
  const offset = (size - 24 * scale) / 2
  return `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none"
    stroke="${COURT_FOREGROUND}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 18h16"/><path d="M7 18V9"/><path d="M12 18V5"/><path d="M17 18v-6"/>
  </g>`
}

/** Full-bleed square (iOS and Android round the corners themselves). */
const squareIcon = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${COURT}"/>${bars(size, 0.56)}
  </svg>`

/** The header's mark: a rounded square (favicon, splash). Radius 10/32 like AppMark. */
const roundedMark = (size: number) =>
  `<rect width="${size}" height="${size}" rx="${(size * 10) / 32}" fill="${COURT}"/>${bars(size, 18 / 32)}`

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${roundedMark(32)}</svg>\n`

/** 2732 px square, the mark in the middle; the launch screen fills the screen with it. */
function splash() {
  const size = 2732
  const mark = 380
  const at = (size - mark) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${DARK_BACKGROUND}"/>
    <g transform="translate(${at} ${at})">${roundedMark(mark)}</g>
  </svg>`
}

const png = (svg: string, file: string) =>
  sharp(Buffer.from(svg)).flatten().png().toFile(file)

await mkdir(publicIcons, { recursive: true })
await Bun.write(path.join(publicIcons, "icon.svg"), favicon)
await Promise.all([
  png(squareIcon(180), path.join(publicIcons, "apple-touch-icon.png")),
  png(squareIcon(192), path.join(publicIcons, "icon-192.png")),
  // Also the manifest's maskable icon: the mark is 56% wide, inside the safe zone
  // (the middle 80% circle)
  png(squareIcon(512), path.join(publicIcons, "icon-512.png")),
  // iOS: one 1024 px icon, no transparency (flatten)
  png(
    squareIcon(1024),
    path.join(xcassets, "AppIcon.appiconset/AppIcon-512@2x.png"),
  ),
  ...[
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
  ].map((name) => png(splash(), path.join(xcassets, "Splash.imageset", name))),
])
console.log("Icons written to public/icons and ios/App/App/Assets.xcassets")
