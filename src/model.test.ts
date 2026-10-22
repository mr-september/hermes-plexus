import { describe, expect, it } from 'vitest'

import {
  backlinksOf,
  buildGraph,
  clampSplit,
  extractTags,
  extractWikilinks,
  filterGraph,
  indexNote,
  isValidNoteName,
  linkResolver,
  matchesSearch,
  neighborhood,
  relativeTo,
  retargetLinks,
  rewriteWikilinks,
  stripFrontmatter,
  wikilinksToMarkdown
} from './model'

describe('relativeTo', () => {
  it('strips a Windows root case-insensitively and normalises slashes', () => {
    expect(relativeTo('C:\\Users\\Larry\\HermesMemory', 'c:\\users\\larry\\HermesMemory\\Daily\\a.md')).toBe(
      'Daily/a.md'
    )
  })

  it('rejects paths outside the root, including a sibling that shares the prefix', () => {
    expect(relativeTo('C:\\v', 'C:\\vault2\\a.md')).toBeNull()
    expect(relativeTo('C:\\v', 'C:\\other\\a.md')).toBeNull()
  })
})

describe('extractWikilinks', () => {
  it('returns the target, dropping alias and heading', () => {
    expect(extractWikilinks('see [[Foo]], [[Bar|the bar]] and [[Baz#Intro]] and [[Qux#H|x]]')).toEqual([
      'Foo',
      'Bar',
      'Baz',
      'Qux'
    ])
  })

  it('counts embeds and ignores links inside fenced and inline code', () => {
    const text = 'real [[A]] ![[Emb]]\n```\n[[Fenced]]\n```\n`[[Inline]]` and [[B]]'

    expect(extractWikilinks(text)).toEqual(['A', 'Emb', 'B'])
  })
})

describe('linkResolver', () => {
  const resolve = linkResolver(['Projects/Foo.md', 'Daily/2026/Foo.md', 'Concepts/Bar Baz.md', 'People/Ann.md'])

  it('matches a bare name case-insensitively, shallowest path first', () => {
    expect(resolve('foo')).toBe('Projects/Foo.md')
    expect(resolve('bar baz')).toBe('Concepts/Bar Baz.md')
  })

  it('matches a path tail and tolerates an .md suffix', () => {
    expect(resolve('2026/Foo')).toBe('Daily/2026/Foo.md')
    expect(resolve('People/Ann.md')).toBe('People/Ann.md')
  })

  it('leaves unresolved targets undefined', () => {
    expect(resolve('Nope')).toBeUndefined()
  })
})

describe('rewriteWikilinks', () => {
  const upper = (target: string) => (target === 'Old' ? 'New' : null)

  it('rewrites matching targets and keeps alias, heading and embed marker', () => {
    const { count, text } = rewriteWikilinks('[[Old]] [[Old|x]] [[Old#H]] ![[Old]] [[Other]]', upper)

    expect(text).toBe('[[New]] [[New|x]] [[New#H]] ![[New]] [[Other]]')
    expect(count).toBe(4)
  })

  it('leaves links in code untouched', () => {
    const src = '`[[Old]]`\n```\n[[Old]]\n```\n[[Old]]'

    expect(rewriteWikilinks(src, upper).text).toBe('`[[Old]]`\n```\n[[Old]]\n```\n[[New]]')
  })
})

describe('retargetLinks', () => {
  const resolveBefore = linkResolver(['A/Old.md', 'B/Other.md'])

  it('renames bare links only when the file name changes, and only for the moved note', () => {
    const map = retargetLinks('A/Old.md', 'A/New.md', resolveBefore)

    expect(map('Old')).toBe('New')
    expect(map('A/Old')).toBe('A/New')
    expect(map('Other')).toBeNull()
  })

  it('keeps bare links for a pure move but rewrites path-qualified ones', () => {
    const map = retargetLinks('A/Old.md', 'C/Old.md', resolveBefore)

    expect(map('Old')).toBeNull()
    expect(map('A/Old')).toBe('C/Old')
  })
})

describe('tags', () => {
  it('reads inline, list and bracket frontmatter tags plus #tags, skipping code and headings', () => {
    const text = '---\ntags: [Alpha, "beta"]\n---\n# Heading\nbody #gamma `#nope`\n```\n#fenced\n```'

    expect(extractTags(text).sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(extractTags('---\ntags:\n  - one\n  - two\n---\n')).toEqual(['one', 'two'])
  })

  it('strips only a leading frontmatter block', () => {
    expect(stripFrontmatter('---\ntags: [a]\n---\nbody\n---\nnot fm')).toBe('body\n---\nnot fm')
    expect(stripFrontmatter('no fm\n---\nx\n---\n')).toBe('no fm\n---\nx\n---\n')
  })
})

describe('graph', () => {
  const graph = buildGraph([
    indexNote('A.md', 'links [[B]] [[B]] [[Missing]] [[A]] #top'),
    indexNote('Projects/B.md', '[[A]]'),
    indexNote('Projects/C.md', 'alone'),
    indexNote('Daily/D.md', '[[C]]')
  ])

  it('dedupes edges and drops self and unresolved links', () => {
    expect(graph.edges).toEqual([
      { source: 'A.md', target: 'Projects/B.md' },
      { source: 'Projects/B.md', target: 'A.md' },
      { source: 'Daily/D.md', target: 'Projects/C.md' }
    ])
  })

  it('counts degree, folder cluster and tags; backlinks come from edges', () => {
    const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]))

    expect(byId['A.md']).toMatchObject({ degree: 2, folder: '', tags: ['top'], title: 'A' })
    expect(backlinksOf(graph, 'A.md')).toEqual(['Projects/B.md'])
  })

  it('finds a neighbourhood by hops', () => {
    expect([...neighborhood(graph, 'A.md', 1)].sort()).toEqual(['A.md', 'Projects/B.md'])
    expect([...neighborhood(graph, 'Daily/D.md', 1)].sort()).toEqual(['Daily/D.md', 'Projects/C.md'])
    expect(neighborhood(graph, 'Daily/D.md', 0).size).toBe(1)
  })

  it('filters by folder, locality and orphans', () => {
    const base = { hiddenFolders: new Set<string>(), local: null, showOrphans: true }

    expect(filterGraph(graph, { ...base, hiddenFolders: new Set(['Projects']) }).nodes.map(n => n.id)).toEqual([
      'A.md',
      'Daily/D.md'
    ])
    expect(filterGraph(graph, { ...base, local: { depth: 1, rel: 'A.md' } }).edges).toHaveLength(2)

    const lonely = buildGraph([indexNote('X.md', ''), indexNote('Y.md', '[[Z]]'), indexNote('Z.md', '')])

    expect(filterGraph(lonely, { ...base, showOrphans: false }).nodes.map(n => n.id)).toEqual(['Y.md', 'Z.md'])
  })

  it('searches titles, paths and #tags', () => {
    const node = graph.nodes[0]!

    expect(matchesSearch(node, '')).toBe(true)
    expect(matchesSearch(node, 'a')).toBe(true)
    expect(matchesSearch(node, '#to')).toBe(true)
    expect(matchesSearch(node, '#zzz')).toBe(false)
    expect(matchesSearch(node, 'projects/')).toBe(false)
  })
})

describe('view helpers', () => {
  it('clampSplit snaps to the ends so a drag can fully hide either side', () => {
    expect(clampSplit(0.01)).toBe(0)
    expect(clampSplit(-3)).toBe(0)
    expect(clampSplit(0.99)).toBe(1)
    expect(clampSplit(0.4)).toBe(0.4)
    expect(clampSplit(Number.NaN)).toBe(0)
  })

  it('turns wikilinks into interceptable markdown links, honouring aliases', () => {
    expect(wikilinksToMarkdown('go [[Foo Bar|there]] or [[Baz]]')).toBe(
      'go [there](#vault/Foo%20Bar) or [Baz](#vault/Baz)'
    )
  })

  it('validates note names', () => {
    expect(isValidNoteName('Good name')).toBe(true)
    expect(isValidNoteName('bad/name')).toBe(false)
    expect(isValidNoteName('  ')).toBe(false)
    expect(isValidNoteName('..')).toBe(false)
    expect(isValidNoteName('a:b')).toBe(false)
  })
})
