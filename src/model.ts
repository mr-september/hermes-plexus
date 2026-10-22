/**
 * Pure vault model: path math, wikilink parsing/resolution/rewriting, tags,
 * graph building and view helpers. No DOM, no bridge — all unit-tested.
 */

export interface VaultNote {
  /** Absolute path as the Electron bridge reports it. */
  path: string
  /** Vault-relative path with forward slashes, e.g. `Projects/Foo.md`. */
  rel: string
}

export interface GraphNode {
  degree: number
  /** Top-level folder, '' for notes at the vault root — the cluster key. */
  folder: string
  id: string
  tags: string[]
  title: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface VaultGraph {
  edges: GraphEdge[]
  nodes: GraphNode[]
}

/** What one note contributes to the graph. */
export interface NoteIndex {
  links: string[]
  rel: string
  tags: string[]
}

export const EMPTY_GRAPH: VaultGraph = { edges: [], nodes: [] }

export const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/')

/** `abs` relative to `root` (case-insensitive prefix, as on Windows), or null when outside it. */
export function relativeTo(root: string, abs: string): null | string {
  const base = normalizeSlashes(root).replace(/\/+$/, '')
  const target = normalizeSlashes(abs)

  return target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : null
}

export const noteTitle = (rel: string): string => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '')

export const noteFolder = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '')

export const parentDir = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

// ---- code masking ------------------------------------------------------------------------------

const FENCE = /^(```|~~~)[\s\S]*?^\1[^\n]*$/gm
const INLINE_CODE = /`[^`\n]*`/g

/** Ranges of fenced and inline code, so link/tag scanning can ignore them. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []

  for (const re of [FENCE, INLINE_CODE]) {
    for (const match of text.matchAll(re)) {
      ranges.push([match.index, match.index + match[0].length])
    }
  }

  return ranges
}

const inRanges = (ranges: readonly [number, number][], at: number): boolean =>
  ranges.some(([from, to]) => at >= from && at < to)

// ---- wikilinks ---------------------------------------------------------------------------------

const WIKILINK = /(!?)\[\[([^\]|#\n]+)((?:#[^\]|\n]*)?)((?:\|[^\]\n]*)?)\]\]/g

/** Link targets (`[[Target|alias#heading]]` → `Target`), ignoring code. */
export function extractWikilinks(text: string): string[] {
  const code = codeRanges(text)
  const targets: string[] = []

  for (const match of text.matchAll(WIKILINK)) {
    const target = match[2]!.trim()

    if (target && !inRanges(code, match.index)) {
      targets.push(target)
    }
  }

  return targets
}

/** Rewrite link targets: `map` returns the new target, or null to leave a link alone. Code is skipped. */
export function rewriteWikilinks(
  text: string,
  map: (target: string) => null | string
): { count: number; text: string } {
  const code = codeRanges(text)
  let count = 0

  const out = text.replace(
    WIKILINK,
    (whole, bang: string, target: string, heading: string, alias: string, offset: number) => {
      if (inRanges(code, offset)) {
        return whole
      }

      const next = map(target.trim())

      if (next === null || next === target.trim()) {
        return whole
      }

      count++

      return `${bang}[[${next}${heading}${alias}]]`
    }
  )

  return { count, text: out }
}

const stripMd = (value: string): string => value.replace(/\.md$/i, '')

/** Obsidian-style resolution: a bare name matches a note's file name (shallowest
 *  path wins); a name with a slash matches the tail of a note's path. */
export function linkResolver(rels: readonly string[]): (target: string) => string | undefined {
  const byName = new Map<string, string[]>()
  const ordered = [...rels].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)

  for (const rel of ordered) {
    const key = noteTitle(rel).toLowerCase()

    byName.set(key, [...(byName.get(key) ?? []), rel])
  }

  return target => {
    const wanted = stripMd(normalizeSlashes(target)).toLowerCase()

    if (!wanted.includes('/')) {
      return byName.get(wanted)?.[0]
    }

    return ordered.find(rel => {
      const lower = stripMd(rel).toLowerCase()

      return lower === wanted || lower.endsWith(`/${wanted}`)
    })
  }
}

/**
 * The link rewriter for a note that was renamed or moved from `oldRel` to `newRel`.
 * Resolution uses the notes as they were BEFORE the change. Bare-name links only
 * change when the file name changed; path-qualified links always follow the move.
 */
export function retargetLinks(
  oldRel: string,
  newRel: string,
  resolveBefore: (target: string) => string | undefined
): (target: string) => null | string {
  return target => {
    if (resolveBefore(target) !== oldRel) {
      return null
    }

    if (target.includes('/')) {
      return stripMd(newRel)
    }

    return noteTitle(newRel) === noteTitle(oldRel) ? null : noteTitle(newRel)
  }
}

// ---- tags --------------------------------------------------------------------------------------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const INLINE_TAG = /(?:^|[\s(])#([A-Za-z][\w/-]*)/g

export const stripFrontmatter = (text: string): string => text.replace(FRONTMATTER, '')

const cleanTag = (raw: string): string => raw.trim().replace(/^#|^["']|["']$/g, '')

function frontmatterTags(text: string): string[] {
  const block = FRONTMATTER.exec(text)?.[1]

  if (!block) {
    return []
  }

  const tags: string[] = []
  const lines = block.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    const head = /^tags?\s*:\s*(.*)$/i.exec(line)

    if (!head) {
      continue
    }

    const inline = head[1]!.trim()

    if (inline) {
      tags.push(...inline.replace(/^\[|\]$/g, '').split(',').map(cleanTag))
    } else {
      for (const item of lines.slice(index + 1)) {
        const listed = /^\s+-\s*(.+)$/.exec(item)

        if (!listed) {
          break
        }

        tags.push(cleanTag(listed[1]!))
      }
    }
  }

  return tags.filter(Boolean)
}

/** Tags from frontmatter (`tags:`) and inline `#tag`s outside code, lowercased and de-duplicated. */
export function extractTags(text: string): string[] {
  const body = stripFrontmatter(text)
  const code = codeRanges(body)
  const tags = new Set(frontmatterTags(text).map(tag => tag.toLowerCase()))

  for (const match of body.matchAll(INLINE_TAG)) {
    if (!inRanges(code, match.index)) {
      tags.add(match[1]!.toLowerCase())
    }
  }

  return [...tags]
}

export const indexNote = (rel: string, text: string): NoteIndex => ({
  links: extractWikilinks(text),
  rel,
  tags: extractTags(text)
})

// ---- graph -------------------------------------------------------------------------------------

export function buildGraph(notes: readonly NoteIndex[]): VaultGraph {
  const resolve = linkResolver(notes.map(note => note.rel))
  const degree = new Map(notes.map(note => [note.rel, 0]))
  const seen = new Set<string>()
  const edges: GraphEdge[] = []

  for (const note of notes) {
    for (const link of note.links) {
      const target = resolve(link)
      const key = `${note.rel}\0${target}`

      if (!target || target === note.rel || seen.has(key)) {
        continue
      }

      seen.add(key)
      edges.push({ source: note.rel, target })
      degree.set(note.rel, (degree.get(note.rel) ?? 0) + 1)
      degree.set(target, (degree.get(target) ?? 0) + 1)
    }
  }

  return {
    edges,
    nodes: notes.map(note => ({
      degree: degree.get(note.rel) ?? 0,
      folder: noteFolder(note.rel),
      id: note.rel,
      tags: note.tags,
      title: noteTitle(note.rel)
    }))
  }
}

export const backlinksOf = (graph: VaultGraph, rel: string): string[] =>
  graph.edges.filter(edge => edge.target === rel).map(edge => edge.source)

/** The notes a given note links to or is linked from, within `depth` hops (the note itself included). */
export function neighborhood(graph: VaultGraph, rel: string, depth: number): Set<string> {
  const adjacent = new Map<string, string[]>()

  for (const { source, target } of graph.edges) {
    adjacent.set(source, [...(adjacent.get(source) ?? []), target])
    adjacent.set(target, [...(adjacent.get(target) ?? []), source])
  }

  const seen = new Set([rel])
  let frontier = [rel]

  for (let hop = 0; hop < depth; hop++) {
    frontier = frontier.flatMap(node => adjacent.get(node) ?? []).filter(next => !seen.has(next))
    frontier.forEach(next => seen.add(next))
  }

  return seen
}

export interface GraphFilter {
  /** Notes in these top-level folders are hidden (`''` = the vault root). */
  hiddenFolders: ReadonlySet<string>
  /** Restrict to the neighbourhood of this note. */
  local: null | { depth: number; rel: string }
  showOrphans: boolean
}

/** The subgraph the view draws. Search is NOT applied here — it dims instead of removing. */
export function filterGraph(graph: VaultGraph, filter: GraphFilter): VaultGraph {
  const allowed = filter.local ? neighborhood(graph, filter.local.rel, filter.local.depth) : null

  const keep = new Set(
    graph.nodes
      .filter(
        node =>
          !filter.hiddenFolders.has(node.folder) &&
          (!allowed || allowed.has(node.id)) &&
          (filter.showOrphans || node.degree > 0 || node.id === filter.local?.rel)
      )
      .map(node => node.id)
  )

  return {
    edges: graph.edges.filter(edge => keep.has(edge.source) && keep.has(edge.target)),
    nodes: graph.nodes.filter(node => keep.has(node.id))
  }
}

/** Search terms: `#tag` matches tag prefixes, anything else matches title or path (case-insensitive). */
export function matchesSearch(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase()

  if (!q) {
    return true
  }

  return q.startsWith('#')
    ? node.tags.some(tag => tag.startsWith(q.slice(1)))
    : node.title.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)
}

// ---- view helpers ------------------------------------------------------------------------------

/** Splitter position (fraction given to the note pane), snapping to the ends so
 *  dragging "all the way" fully hides one side. */
export function clampSplit(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0.02) {
    return 0
  }

  return fraction >= 0.98 ? 1 : fraction
}

/** Stable hue (0–359) per key, for cluster colouring. */
export function folderHue(key: string): number {
  let hash = 0

  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return hash % 360
}

/** Wikilinks → markdown links the preview can intercept (`#vault/<target>`). */
export function wikilinksToMarkdown(text: string): string {
  return text.replace(WIKILINK, (_whole, bang: string, target: string, _heading: string, alias: string) => {
    const label = alias.slice(1).trim() || target.trim()

    return `${bang ? '↪ ' : ''}[${label}](#vault/${encodeURIComponent(target.trim())})`
  })
}

/** A name that is safe as a note file name on Windows and POSIX. */
export const isValidNoteName = (name: string): boolean => {
  const clean = name.trim().replace(/\.md$/i, '')

  return clean.length > 0 && clean.length <= 200 && !/[\\/:*?"<>|]/.test(clean) && !/^\.+$/.test(clean)
}
