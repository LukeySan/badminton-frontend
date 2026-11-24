/// <reference types="bun" />
// Where text overlays may wrap, shared with the backend: the export draws overlays
// with Pillow and wraps them with ICU's line breaking (PyICU), the preview lets the
// browser wrap them with CSS (also ICU: dictionary word breaks for Thai, which has
// no spaces), with a <wbr> at each Thai word boundary from `linePieces` (overlays.ts,
// Intl.Segmenter). This test checks those pieces against
// tests/fixtures/line-breaks/thai.json; the backend checks the same file (its copy:
// backend/tests/fixtures/line_breaks/thai.json) against PyICU.
//
// Run: `bun run test:unit`. After changing the cases below, rewrite the fixture
// with `UPDATE_LINE_BREAKS=1 bun test src/components/Reels/lineBreaks` and copy it
// to the backend.

import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { linePieces as pieces } from "./overlays"

const FIXTURE = join(
  import.meta.dir,
  "../../../tests/fixtures/line-breaks/thai.json",
)

// [name, text, max width in characters]
const CASES: [string, string, number][] = [
  ["one-phrase", "ลูกนี้สุดยอดมาก", 6],
  ["smash", "ตบหนักมากจนคู่แข่งรับไม่ทัน", 8],
  ["last-point", "แต้มสุดท้ายของเกมที่สาม", 9],
  ["mixed-latin", "Rally 5 สุดยอด!", 7],
  ["serve", "เสิร์ฟสั้นแล้วดาดหลังทันที", 10],
  ["space-and-punctuation", "ชนะแล้ว! เกมตัดสินสนุกมาก", 9],
  ["two-phrases", "ตีโต้กันยาวที่สุดในวันนี้ เหนื่อยแต่สนุก", 12],
  ["mai-yamok", "หยอดหน้าเน็ตสวยงามมากจริงๆ", 8],
  ["word-wider-than-a-line", "แบดมินตันประเภทคู่ผสม", 5],
  ["80-characters", "ลูกนี้สุดยอดมาก".repeat(5), 20],
]

const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" })

/** Width without fonts: characters that take space (combining marks, \p{Mn},
 * such as Thai vowels above/below and tone marks, don't). */
function width(text: string): number {
  return [...text].filter((c) => !/\p{Mn}/u.test(c)).length
}

/** Greedy fill, like CSS with `overflow-wrap: anywhere`: trailing spaces don't
 * count; a piece too wide for a line of its own starts a new line and breaks
 * between grapheme clusters. */
function wrap(text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const piece of pieces(text)) {
    if (current && width((current + piece).trimEnd()) <= maxWidth) {
      current += piece
      continue
    }
    if (current) lines.push(current)
    current = ""
    if (width(piece.trimEnd()) <= maxWidth) {
      current = piece
      continue
    }
    for (const { segment } of graphemes.segment(piece)) {
      if (current.trim() && width((current + segment).trimEnd()) > maxWidth) {
        lines.push(current)
        current = segment
      } else current += segment
    }
  }
  if (current) lines.push(current)
  return lines.map((line) => line.trimEnd()).filter((line) => line)
}

function build() {
  return {
    about:
      "Thai line breaks for text overlays, from Intl.Segmenter (frontend " +
      "src/components/Reels/lineBreaks.fixtures.test.ts). pieces: the text cut " +
      "where a line may break (each word with the spaces and punctuation after " +
      "it). lines: greedy wrap at max_width, measured in characters that take " +
      "space (not \\p{Mn}), trailing spaces not counted; a piece wider than a " +
      "line breaks between grapheme clusters. The backend checks the same " +
      "file against PyICU (worker/caption_image.py).",
    cases: CASES.map(([name, text, maxWidth]) => ({
      name,
      text,
      max_width: maxWidth,
      pieces: pieces(text),
      lines: wrap(text, maxWidth),
    })),
  }
}

test("Thai line breaks match the shared fixture", () => {
  const built = build()
  if (process.env.UPDATE_LINE_BREAKS) {
    writeFileSync(FIXTURE, `${JSON.stringify(built, null, 2)}\n`)
  }
  expect(built).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")))
})

test("every line fits and nothing is lost", () => {
  for (const { text, max_width, lines } of build().cases) {
    expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""))
    // Only a single grapheme may be wider than a line; here none is
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(max_width)
  }
})
