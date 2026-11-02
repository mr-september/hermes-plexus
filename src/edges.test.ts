import { describe, expect, it } from 'vitest'

import { drawnEdges, edgeClass, segmentInView } from './edges'

const n = (id: string, dir: string) => ({ dir, folder: dir.split('/')[0]!, id })

describe('edgeClass', () => {
  it('is exhaustive and ordered: same dir, then same non-empty top-level folder, otherwise across', () => {
    expect(edgeClass(n('a', ''), n('b', ''))).toBe('compartment')
    expect(edgeClass(n('a', 'A/B'), n('b', 'A/B'))).toBe('compartment')
    // The LCA of A and A/B is one endpoint's own folder, yet they share the top-level folder A.
    expect(edgeClass(n('a', 'A'), n('b', 'A/B'))).toBe('top')
    expect(edgeClass(n('a', 'A/B'), n('b', 'A/C'))).toBe('top')
    expect(edgeClass(n('a', 'A'), n('b', 'D'))).toBe('across')
    expect(edgeClass(n('a', ''), n('b', 'A'))).toBe('across')
  })
})

describe('drawnEdges', () => {
  it('keeps one edge per linked pair and drops edges to unknown notes', () => {
    const nodes = new Map([n('a', 'A'), n('b', 'A'), n('c', 'D')].map(node => [node.id, node]))

    const out = drawnEdges(nodes, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'a', target: 'c' },
      { source: 'a', target: 'gone' }
    ])

    expect(out.map(edge => [edge.source.id, edge.target.id, edge.class])).toEqual([
      ['a', 'b', 'compartment'],
      ['a', 'c', 'across']
    ])
  })
})

describe('segmentInView', () => {
  const view = { bottom: 100, left: 0, right: 100, top: 0 }

  it('keeps a segment that crosses the view with both ends outside it, and drops one that misses, within the margin', () => {
    expect(segmentInView({ x: -50, y: 50 }, { x: 150, y: 50 }, view, 0)).toBe(true)
    expect(segmentInView({ x: -50, y: -50 }, { x: -10, y: -10 }, view, 0)).toBe(false)
    expect(segmentInView({ x: -50, y: 50 }, { x: -1, y: 50 }, view, 0)).toBe(false)
    expect(segmentInView({ x: -50, y: 50 }, { x: -1, y: 50 }, view, 2)).toBe(true)
  })
})
