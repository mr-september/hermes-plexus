import { describe, expect, it } from 'vitest'

import { syntheticGraph } from '../demo/synthetic'
import { buildGraph, indexNote, radiusOf } from './model'
import { COLLIDE_PAD, compartmentRadii, computeGeometry, type Geometry, regionAt, regionChain, regionOfDir } from './regions'

const EPS = 1e-6

const graphOf = (...rels: string[]) => buildGraph(rels.map(rel => indexNote(rel, '')))
const many = (dir: string, n: number) => Array.from({ length: n }, (_, i) => `${dir ? `${dir}/` : ''}n${i}.md`)
const gap = (a: { r: number; x: number; y: number }, b: { r: number; x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r

/** The hard guarantees: children inside parents, siblings (and the compartment) pairwise disjoint, every folder resolves. */
function expectSound(geometry: Geometry) {
  for (const region of geometry.regions.values()) {
    const kids = region.children.map(id => geometry.regions.get(id)!)
    const inContent = (d: { r: number; x: number; y: number }) =>
      expect(Math.hypot(d.x - region.content.x, d.y - region.content.y) + d.r).toBeLessThanOrEqual(region.content.r + EPS)

    // The label band: the content sits inside the region and touches its bottom edge, so the crescent above it is free.
    expect(Math.hypot(region.content.x - region.x, region.content.y - region.y) + region.content.r).toBeLessThanOrEqual(region.r + EPS)

    if (region.id !== '') {
      expect(region.content.y - region.y + region.content.r).toBeCloseTo(region.r, 6)
      expect(region.content.r).toBeLessThan(region.r)
    }

    for (const kid of kids) {
      inContent(kid)
      expect(Math.hypot(kid.x - region.x, kid.y - region.y) + kid.r).toBeLessThanOrEqual(region.r + EPS)
      expect(kid.parent).toBe(region.id)
    }

    const own = region.compartment

    if (own) {
      inContent(own)
      expect(Math.hypot(own.x - region.x, own.y - region.y) + own.r).toBeLessThanOrEqual(region.r + EPS)
    }

    const discs = kids.length && own ? [...kids, own] : kids

    discs.forEach((a, i) => discs.slice(i + 1).forEach(b => expect(gap(a, b)).toBeGreaterThanOrEqual(-EPS)))
  }

  for (const [dir, id] of geometry.byDir) {
    expect(geometry.regions.get(id)!.dirs).toContain(dir)
  }
}

describe('region geometry', () => {
  it('is empty for an empty vault', () => {
    const geometry = computeGeometry([])

    expect(geometry.root).toBeNull()
    expect(geometry.regions.size).toBe(0)
    expect(geometry.smallest).toBe(0)
  })

  it('gives root notes one compartment that is also the region', () => {
    const geometry = computeGeometry(graphOf('a.md', 'b.md').nodes)
    const root = geometry.regions.get('')!

    expect(geometry.regions.size).toBe(1)
    expect(root.compartment).toMatchObject({ r: root.r, x: root.x, y: root.y })
    expectSound(geometry)
  })

  it('draws a chain of single-child folders without notes as one region while every folder still resolves to it', () => {
    const geometry = computeGeometry(graphOf('A/B/C/x.md').nodes)

    expect(geometry.regions.size).toBe(1)

    const region = regionOfDir(geometry, 'A/B')!

    expect(region.id).toBe('A/B/C')
    expect(region.label).toBe('A/B/C')
    expect(['', 'A', 'A/B', 'A/B/C'].map(dir => geometry.byDir.get(dir))).toEqual(Array(4).fill('A/B/C'))

    // Notes below the chain split it again: the chain keeps its logical folders, the new level gets its own region.
    const deeper = computeGeometry(graphOf('A/B/C/x.md', 'A/B/C/D/y.md').nodes)

    expect([...deeper.regions.keys()]).toEqual(['A/B/C', 'A/B/C/D'])
    expect(deeper.regions.get('A/B/C/D')!.label).toBe('D')
    expect(regionChain(deeper, 'A/B/C/D').map(r => r.id)).toEqual(['A/B/C', 'A/B/C/D'])
    expectSound(deeper)
  })

  it('keeps a note of A out of A/B: separate compartments, siblings of each other', () => {
    const geometry = computeGeometry(graphOf('r.md', ...many('A', 6), ...many('A/B', 6), ...many('A/C', 3)).nodes)
    const a = geometry.regions.get('A')!

    expect(a.children).toEqual(expect.arrayContaining(['A/B', 'A/C']))
    expect(gap(a.compartment!, geometry.regions.get('A/B')!.compartment!)).toBeGreaterThan(0)
    expect(geometry.compartments.size).toBe(4)
    expectSound(geometry)
  })

  it('packs two equal children into a parent of at least twice their radius (not the area-additive sqrt 2)', () => {
    const geometry = computeGeometry(graphOf(...many('A', 4), ...many('B', 4)).nodes)
    const [a, b] = ['A', 'B'].map(id => geometry.regions.get(id)!)

    expect(a!.r).toBeCloseTo(b!.r, 9)
    expect(geometry.regions.get('')!.r).toBeGreaterThanOrEqual(2 * a!.r)
  })

  it('handles skewed sizes and folder-per-note vaults', () => {
    const skewed = computeGeometry(graphOf(...many('A', 300), 'B/x.md', 'C/x.md', 'D/E/x.md').nodes)

    expect(skewed.regions.get('A')!.r).toBeGreaterThan(5 * skewed.regions.get('B')!.r)
    expectSound(skewed)

    const perNote = computeGeometry(syntheticGraph({ depth: 2, folderPerNote: true, notes: 80 }).nodes)

    expect(perNote.regions.size).toBeGreaterThan(80)
    expectSound(perNote)
  })

  it('is deterministic and independent of note order', () => {
    const graph = syntheticGraph({ depth: 3, notes: 120, seed: 7, skew: 1 })
    const first = computeGeometry(graph.nodes)
    const again = computeGeometry([...graph.nodes].reverse())

    expect(JSON.stringify([...again.regions])).toBe(JSON.stringify([...first.regions]))
    expect(again.signature).toBe(first.signature)
  })

  it('holds the guarantees on random folder trees', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const graph = syntheticGraph({
        branching: 2 + (seed % 4),
        depth: 1 + (seed % 4),
        folderPerNote: seed % 7 === 0,
        notes: 20 + seed * 9,
        seed,
        skew: (seed % 3) * 0.8
      })

      expectSound(computeGeometry(graph.nodes))
    }
  })

  it('sizes a compartment for its largest note and buckets footprints so small additions do not move the map', () => {
    const base = compartmentRadii(graphOf(...many('A', 20)).nodes).get('A')!
    const plus = compartmentRadii(graphOf(...many('A', 21)).nodes).get('A')!
    const hub = indexNote('A/hub.md', Array.from({ length: 80 }, (_, i) => `[[s${i}]]`).join(' '))
    const star = buildGraph([hub, ...Array.from({ length: 80 }, (_, i) => indexNote(`A/s${i}.md`, ''))])
    const hubNode = star.nodes.find(n => n.id === 'A/hub.md')!

    expect(compartmentRadii(star.nodes).get('A')!).toBeGreaterThanOrEqual(radiusOf(hubNode) + COLLIDE_PAD)
    expect(plus).toBeGreaterThanOrEqual(base)
    // One extra note usually stays in the same bucket (identical radius); a bucket change can only grow it.
    expect(plus / base).toBeLessThan(1.5)
  })

  it('hit-tests to the deepest drawn region and respects the visibility predicate', () => {
    const geometry = computeGeometry(graphOf(...many('A', 5), ...many('A/B', 5), ...many('C', 5)).nodes)
    const b = geometry.regions.get('A/B')!

    expect(regionAt(geometry, b.x, b.y, () => true)!.id).toBe('A/B')
    expect(regionAt(geometry, b.x, b.y, r => r.id !== 'A/B')!.id).toBe('A')
    expect(regionAt(geometry, 1e9, 1e9, () => true)).toBeNull()
  })
})
