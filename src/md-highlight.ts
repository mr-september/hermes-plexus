/**
 * A small markdown highlighter: headings, emphasis, code, links, quotes, wikilinks, tags and
 * frontmatter, as plain decorations. It is deliberately not a parser — it stays regex-based so the
 * plugin ships without the language-parser stack (which patches its own classes at load time and
 * would fail the catalog's static admission lint).
 */

export interface Mark {
  cls: string
  from: number
  /** A whole-line decoration (`from` is the line start) rather than a range mark. */
  line?: boolean
  to: number
}

/** Documents larger than this are left unhighlighted to keep typing responsive. */
export const HIGHLIGHT_LIMIT = 300_000

const INLINE: [RegExp, string][] = [
  [/`[^`\n]+`/g, 'cm-md-code'],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/g, 'cm-md-bold'],
  [/(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w])|(?<![_\w])_[^_\s][^_\n]*_(?![_\w])/g, 'cm-md-italic'],
  [/~~[^~\n]+~~/g, 'cm-md-strike'],
  [/!?\[\[[^\]\n]+\]\]/g, 'cm-wikilink'],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/g, 'cm-md-link'],
  [/(?<=^|[\s(])#[A-Za-z][\w/-]*/g, 'cm-md-tag']
]

export function computeMarks(text: string): Mark[] {
  if (text.length > HIGHLIGHT_LIMIT) {
    return []
  }

  const marks: Mark[] = []
  let offset = 0
  let fence: null | string = null
  let inFrontmatter = false

  const lines = text.split('\n')

  for (const [index, raw] of lines.entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const end = offset + line.length

    if (index === 0 && line === '---') {
      inFrontmatter = true
      marks.push({ cls: 'cm-md-fm', from: offset, line: true, to: offset })
    } else if (inFrontmatter) {
      marks.push({ cls: 'cm-md-fm', from: offset, line: true, to: offset })

      if (line === '---') {
        inFrontmatter = false
      }
    } else if (fence) {
      marks.push({ cls: 'cm-md-codeblock', from: offset, line: true, to: offset })

      if (line.trimStart().startsWith(fence)) {
        fence = null
      }
    } else {
      const open = /^\s*(```|~~~)/.exec(line)

      if (open) {
        fence = open[1]!
        marks.push({ cls: 'cm-md-codeblock', from: offset, line: true, to: offset })
      } else {
        const heading = /^(#{1,6})\s/.exec(line)

        if (heading) {
          marks.push({ cls: `cm-md-h cm-md-h${heading[1]!.length}`, from: offset, line: true, to: offset })
        } else if (/^\s*>/.test(line)) {
          marks.push({ cls: 'cm-md-quote', from: offset, line: true, to: offset })
        }

        const bullet = /^\s*(?:[-*+]|\d+[.)])\s/.exec(line)

        if (bullet) {
          marks.push({ cls: 'cm-md-list', from: offset, to: offset + bullet[0].length })
        }

        // Code spans win over anything inside them: skip inline marks that overlap one.
        const taken: [number, number][] = []

        for (const [re, cls] of INLINE) {
          for (const match of line.matchAll(re)) {
            const from = match.index
            const to = from + match[0].length

            if (taken.some(([a, b]) => from < b && to > a)) {
              continue
            }

            if (cls === 'cm-md-code') {
              taken.push([from, to])
            }

            marks.push({ cls, from: offset + from, to: offset + to })
          }
        }
      }
    }

    offset = end + (raw.endsWith('\r') ? 2 : 1)
  }

  return marks
}
