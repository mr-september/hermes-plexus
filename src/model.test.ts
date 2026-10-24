import { describe, expect, it } from 'vitest'

import {
  assetResolver,
  backlinksOf,
  buildGraph,
  clampSplit,
  extractTags,
  extractWikilinks,
  fileRef,
  filterGraph,
  findAnchorLine,
  folderHues,
  indexNote,
  isValidNoteName,
  linkResolver,
  matchesSearch,
  neighborhood,
  parseLinkTarget,
  relativeTo,
  retargetLinks,
  rewriteWikilinks,
  sectionOf,
  splitPreview,
  stripFrontmatter,
  wikilinksToMarkdown,
  withoutRawHtml
} from './model'

describe('fileRef', () => {
  it('quotes a path with spaces so the composer reads it whole, and leaves plain paths bare', () => {
    expect(fileRef('C:\\Notes\\a.md')).toBe('@file:C:\\Notes\\a.md')
    expect(fileRef('C:\\My Vault\\a.md')).toBe('@file:`C:\\My Vault\\a.md`')
    expect(fileRef("/home/x/it`s a \"vault\"/a.md")).toBe("@file:'/home/x/it`s a \"vault\"/a.md'")
  })
})

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
    expect(wikilinksToMarkdown('go [[Foo Bar|there]] or [[Baz]] or [[Qux#Sec 1]]')).toBe(
      'go [there](#vault/Foo%20Bar) or [Baz](#vault/Baz) or [Qux](#vault/Qux%23Sec%201)'
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

describe('anchors', () => {
  it('splits a link target into note and anchor', () => {
    expect(parseLinkTarget('Note')).toEqual({ anchor: null, note: 'Note' })
    expect(parseLinkTarget('A/Note#Some Heading')).toEqual({ anchor: 'Some Heading', note: 'A/Note' })
    expect(parseLinkTarget('Note#^abc')).toEqual({ anchor: '^abc', note: 'Note' })
    expect(parseLinkTarget('Note#')).toEqual({ anchor: null, note: 'Note' })
  })

  it('finds headings (case-insensitive, formatting-insensitive, outside code) and block ids', () => {
    const text = '# Top\n```\n# Hidden\n```\n## **Second** part ##\npara ^blk1\n'

    expect(findAnchorLine(text, 'top')).toBe(0)
    expect(findAnchorLine(text, 'Hidden')).toBe(-1)
    expect(findAnchorLine(text, 'second part')).toBe(4)
    expect(findAnchorLine(text, '^blk1')).toBe(5)
    expect(findAnchorLine(text, '^nope')).toBe(-1)
  })
})

describe('splitPreview', () => {
  it('pulls out local images and note embeds, keeping the markdown around them', () => {
    const text = 'a ![[pic.png|300]] b ![alt](img/p%20q.jpg) c ![[Other#Sec]] d ![r](https://x/y.png) e'

    expect(splitPreview(text)).toEqual([
      { kind: 'md', text: 'a ' },
      { alt: '', kind: 'image', target: 'pic.png', width: 300 },
      { kind: 'md', text: ' b ' },
      { alt: 'alt', kind: 'image', target: 'img/p q.jpg', width: null },
      { kind: 'md', text: ' c ' },
      { anchor: 'Sec', kind: 'embed', target: 'Other' },
      { kind: 'md', text: ' d ' },
      { alt: 'r', kind: 'remote', url: 'https://x/y.png' },
      { kind: 'md', text: ' e' }
    ])
  })

  it('pulls out remote images, including reference-style ones, so the preview can gate them', () => {
    const text = 'a ![one][r1] b ![two][] c ![three](//cdn.example/t?id=3 "title") d ![d](data:image/png;base64,AA) e\n\n[r1]: https://x/one.png\n[two]: http://x/two.png\n'

    expect(splitPreview(text).filter(s => s.kind === 'remote')).toEqual([
      { alt: 'one', kind: 'remote', url: 'https://x/one.png' },
      { alt: 'two', kind: 'remote', url: 'http://x/two.png' },
      { alt: 'three', kind: 'remote', url: '//cdn.example/t?id=3' }
    ])
    // The data-URL image makes no request, so it stays in the markdown.
    expect(JSON.stringify(splitPreview(text))).toContain('data:image/png')
  })

  it('does not treat remote image syntax inside code as an image', () => {
    expect(splitPreview('`![x](https://x/y.png)`')).toEqual([{ kind: 'md', text: '`![x](https://x/y.png)`' }])
  })
})

describe('withoutRawHtml', () => {
  it('escapes tags that can load things, keeps bare formatting tags, autolinks and code', () => {
    expect(withoutRawHtml('a <img src="https://x/y.png"> b <div style="background:url(https://x)">c</div> </p>')).toBe(
      'a &lt;img src="https://x/y.png"> b &lt;div style="background:url(https://x)">c&lt;/div> &lt;/p>'
    )
    expect(withoutRawHtml('x<br>y <kbd>K</kbd> <https://x.test/a> `<img src=x>` <b class="c">')).toBe(
      'x<br>y <kbd>K</kbd> <https://x.test/a> `<img src=x>` &lt;b class="c">'
    )
  })

  it('leaves code alone and returns a single run when nothing matches', () => {
    expect(splitPreview('`![[pic.png]]` text')).toEqual([{ kind: 'md', text: '`![[pic.png]]` text' }])
    expect(splitPreview('plain')).toEqual([{ kind: 'md', text: 'plain' }])
  })
})

describe('assetResolver', () => {
  const resolve = assetResolver(['img/a.png', 'Notes/img/a.png', 'Notes/b.JPG', 'c.svg'])

  it('prefers the file relative to the embedding note, then the shallowest tail match', () => {
    expect(resolve('img/a.png', 'Notes/x.md')).toBe('Notes/img/a.png')
    expect(resolve('img/a.png')).toBe('img/a.png')
    expect(resolve('a.png', 'Other/x.md')).toBe('img/a.png')
    expect(resolve('../c.svg', 'Notes/x.md')).toBe('c.svg')
    expect(resolve('b.jpg')).toBe('Notes/b.JPG')
    expect(resolve('missing.png')).toBeUndefined()
  })
})

describe('sectionOf', () => {
  const text = '# A\nintro\n## B\nb1\n### C\nc1\n## D\nd1 ^blk\n'

  it('returns the whole text without an anchor or when the anchor is missing', () => {
    expect(sectionOf(text, null)).toBe(text)
    expect(sectionOf(text, 'Nope')).toBe(text)
  })

  it('returns a heading section up to the next heading of the same or higher level', () => {
    expect(sectionOf(text, 'B')).toBe('## B\nb1\n### C\nc1')
    expect(sectionOf(text, 'D')).toBe('## D\nd1 ^blk\n')
  })

  it('returns just the block line, without its id', () => {
    expect(sectionOf(text, '^blk')).toBe('d1')
  })
})

describe('folderHues', () => {
  it('spreads hues evenly over the sorted folders so neighbours are far apart', () => {
    const hues = folderHues(['b', '', 'a', 'c'])

    expect([...hues.keys()]).toEqual(['', 'a', 'b', 'c'])
    expect([...hues.values()]).toEqual([205, 295, 25, 115])
    expect(new Set(hues.values()).size).toBe(4)
  })
})
