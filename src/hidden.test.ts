import { describe, expect, it } from 'vitest'

import { coveringEntry, covers, hidePath, isHiddenDir, knownFolders, showPath, subtreeCount } from './hidden'
import { buildGraph, filterGraph, indexNote } from './model'

const graphOf = (...rels: string[]) => buildGraph(rels.map(rel => indexNote(rel, '')))
const hide = (graph: ReturnType<typeof graphOf>, ...entries: string[]) =>
  filterGraph(graph, { hiddenFolders: new Set(entries), local: null, showOrphans: true }).nodes.map(node => node.id)

describe('hidden folder paths', () => {
  it('match on whole path segments: A/B covers A/B/x and A/B itself, never A/BB or A', () => {
    expect(covers('A/B', 'A/B')).toBe(true)
    expect(covers('A/B', 'A/B/C')).toBe(true)
    expect(covers('A/B', 'A/BB')).toBe(false)
    expect(covers('A/B', 'A')).toBe(false)

    const graph = graphOf('A/x.md', 'A/B/y.md', 'A/BB/z.md')

    expect(hide(graph, 'A/B')).toEqual(['A/x.md', 'A/BB/z.md'])
  })

  it("treat '' as the notes directly in the vault root, not the whole vault", () => {
    const graph = graphOf('root.md', 'A/x.md', 'A/B/y.md')

    expect(hide(graph, '')).toEqual(['A/x.md', 'A/B/y.md'])
    expect(isHiddenDir(new Set(['']), 'A')).toBe(false)
    expect(coveringEntry(new Set(['']), 'A')).toBeNull()
  })

  it('keep legacy top-level entries working, now for the whole subtree', () => {
    const graph = graphOf('A/x.md', 'A/B/y.md', 'D/z.md')

    expect(hide(graph, 'A')).toEqual(['D/z.md'])
  })

  it('resolve a folder to its own entry first, then the deepest covering ancestor', () => {
    const entries = new Set(['A', 'A/B'])

    expect(coveringEntry(entries, 'A/B')).toBe('A/B')
    expect(coveringEntry(entries, 'A/B/C')).toBe('A/B')
    expect(coveringEntry(new Set(['A']), 'A/B/C')).toBe('A')
    expect(coveringEntry(entries, 'D')).toBeNull()
    // An entry in the middle of a chain A/B/C covers the chain's region (identified by its deepest folder).
    expect(isHiddenDir(new Set(['A/B']), 'A/B/C')).toBe(true)
  })

  it('store entries as given: ancestors and descendants coexist, and showing one removes only that entry', () => {
    const once = hidePath(['A/B'], 'A')

    expect(once).toEqual({ coveredBy: null, entries: ['A/B', 'A'] })
    expect(showPath(once.entries, 'A')).toEqual(['A/B'])
    expect(showPath(once.entries, 'A/B')).toEqual(['A'])
  })

  it('add nothing for a path that an entry already covers, and say which entry', () => {
    expect(hidePath(['A'], 'A/B')).toEqual({ coveredBy: 'A', entries: ['A'] })
    expect(hidePath(['A'], 'A')).toEqual({ coveredBy: 'A', entries: ['A'] })
  })

  it('list every folder of the scan including intermediate ones, and the root only when a note sits in it', () => {
    expect([...knownFolders(graphOf('A/B/C/x.md').nodes)].sort()).toEqual(['A', 'A/B', 'A/B/C'])
    expect(knownFolders(graphOf('r.md').nodes).has('')).toBe(true)
  })

  it('count a subtree from the unfiltered scan, root notes only for the empty entry, and overlap is not additive', () => {
    const nodes = graphOf('r.md', 'A/x.md', 'A/B/y.md', 'A/B/z.md').nodes

    expect(subtreeCount(nodes, '')).toBe(1)
    expect(subtreeCount(nodes, 'A')).toBe(3)
    expect(subtreeCount(nodes, 'A/B')).toBe(2)
    expect(subtreeCount(nodes, 'Gone')).toBe(0)
    expect(hide(graphOf('A/x.md', 'A/B/y.md'), 'A', 'A/B')).toEqual([])
  })
})
