import { describe, expect, it } from 'vitest'

import { adjacencyOf, hopTarget, nestedOffsets, occupiedRegions, seedNodes } from './graph-nodes'
import { folderAnchors, type SimLink, type SimNode } from './layout'
import { buildGraph, indexNote } from './model'
import { computeGeometry, EMPTY_GEOMETRY } from './regions'

const graphOf = (notes: Record<string, string>) => buildGraph(Object.entries(notes).map(([rel, text]) => indexNote(rel, text)))
const node = (id: string, x: number, y: number): SimNode => ({ degree: 1, dir: '', folder: '', id, tags: [], title: id, x, y })

describe('seedNodes', () => {
  const graph = graphOf({ 'A/a.md': '[[b]]', 'A/b.md': '', 'B/c.md': '' })
  const base = {
    anchors: folderAnchors(['A', 'B'], 'folder'),
    cluster: 'folder' as const,
    geometry: EMPTY_GEOMETRY,
    graph,
    nestedPositions: {},
    pinned: new Set<string>(),
    previous: new Map<string, SimNode>(),
    previousGeometry: undefined,
    saved: undefined
  }

  it('prefers live positions, then remembered ones, and counts only those as restored', () => {
    const live = node('A/a.md', 5, 6)
    const { nodes, restored } = seedNodes({ ...base, previous: new Map([[live.id, live]]), saved: { 'A/b.md': [7, 8] } })

    expect(restored).toBe(2)
    expect(nodes.map(n => [n.x, n.y]).slice(0, 2)).toEqual([[5, 6], [7, 8]])
    expect(nodes[2]!.x).not.toBe(0)
  })

  it('fixes a pinned note where it starts', () => {
    const { nodes } = seedNodes({ ...base, pinned: new Set(['A/b.md']), saved: { 'A/b.md': [7, 8] } })

    expect(nodes.find(n => n.id === 'A/b.md')).toMatchObject({ fx: 7, fy: 8 })
    expect(nodes.find(n => n.id === 'A/a.md')!.fx).toBeUndefined()
  })
})

describe('nested helpers', () => {
  const graph = graphOf({ 'A/B/x.md': '', 'A/z.md': '', 'C/y.md': '' })
  const geometry = computeGeometry(graph.nodes)
  const nodes = graph.nodes.map(n => ({ ...n, x: 0, y: 0 }))

  it('marks a region and all its ancestors occupied, and nothing else', () => {
    const occupied = occupiedRegions(nodes.filter(n => n.dir === 'A/B'), geometry)

    expect(occupied.has('A/B')).toBe(true)
    expect(occupied.has('A')).toBe(true)
    expect(occupied.has('C')).toBe(false)
  })

  it('stores each note as a rounded offset in its own folder', () => {
    const offsets = nestedOffsets(nodes, geometry)

    expect(offsets['A/B/x.md']![0]).toBe('A/B')
    expect(Object.keys(offsets)).toHaveLength(3)
  })
})

describe('hopTarget', () => {
  const [a, b, c, far] = [node('a', 0, 0), node('b', 50, 0), node('c', 0, 50), node('far', 400, 0)]
  const links: SimLink[] = [{ source: a, target: b }, { source: a, target: c }]
  const adjacency = adjacencyOf(links)

  it('picks the linked note best aligned with the arrow, ignoring unlinked ones', () => {
    expect(hopTarget('ArrowRight', a, [a, b, c, far], adjacency)).toBe(b)
    expect(hopTarget('ArrowDown', a, [a, b, c, far], adjacency)).toBe(c)
    expect(hopTarget('ArrowLeft', a, [a, b, c, far], adjacency)).toBeNull()
  })

  it('falls back to every note when the current one has no links', () => {
    expect(hopTarget('ArrowRight', far, [a, b, c, far], new Map())).toBeNull()
    expect(hopTarget('ArrowLeft', far, [a, b, c, far], new Map())).toBe(b)
  })
})
