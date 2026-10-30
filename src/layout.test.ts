import { describe, expect, it } from 'vitest'

import { syntheticGraph } from '../demo/synthetic'
import {
  clampToDisc,
  containAll,
  containNode,
  createSimulation,
  fromOffset,
  seedInCompartment,
  type SimLink,
  type SimNode,
  step,
  toOffset
} from './layout'
import { buildGraph, indexNote, radiusOf, type VaultGraph } from './model'
import { compartmentOf, computeGeometry, type Geometry } from './regions'

const EPS = 1e-6

const many = (dir: string, n: number, links = '') =>
  Array.from({ length: n }, (_, i) => indexNote(`${dir ? `${dir}/` : ''}n${i}.md`, links.replaceAll('#', String((i + 1) % n))))

const ring = (dir: string, n: number) => many(dir, n, '[[n#]]')

/** How far outside its compartment the worst note reaches (0 when every note is wholly inside). */
function worstViolation(nodes: readonly SimNode[], geometry: Geometry): number {
  let worst = 0

  for (const node of nodes) {
    const comp = compartmentOf(geometry, node.dir)!

    worst = Math.max(worst, Math.hypot(node.x - comp.x, node.y - comp.y) + radiusOf(node) - comp.r)
  }

  return worst
}

function rig(graph: VaultGraph) {
  const geometry = computeGeometry(graph.nodes)
  const seen = new Map<string, number>()
  const count = new Map<string, number>()

  graph.nodes.forEach(node => count.set(node.dir, (count.get(node.dir) ?? 0) + 1))

  const nodes: SimNode[] = graph.nodes.map(node => {
    const index = seen.get(node.dir) ?? 0
    const placed: SimNode = { ...node, x: 0, y: 0 }

    seen.set(node.dir, index + 1)
    seedInCompartment(placed, compartmentOf(geometry, node.dir)!, index, count.get(node.dir)!)

    return placed
  })

  const ids = new Set(nodes.map(node => node.id))
  const links: SimLink[] = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e }))
  const sim = createSimulation(nodes, links, { cluster: 'nested', folders: [], geometry }, 1)

  sim.stop()

  return { geometry, nodes, sim }
}

const fixtures: Record<string, VaultGraph> = {
  'collapsed chain': buildGraph(ring('X/Y/Z', 20)),
  'folder per note': syntheticGraph({ depth: 2, folderPerNote: true, links: 3, notes: 60 }),
  'heavy cross-folder links': syntheticGraph({ branching: 2, crossFraction: 0.7, depth: 3, links: 3, notes: 90, seed: 3 }),
  'nested siblings': buildGraph([...ring('', 5), ...ring('A', 15), ...ring('A/B', 10), ...ring('A/C', 10)]),
  'root notes': buildGraph(ring('', 12)),
  'skewed sizes': buildGraph([...ring('A', 120), ...ring('B', 1), ...ring('C', 2), ...ring('D/E', 1)])
}

describe('whole-note containment', () => {
  for (const [name, graph] of Object.entries(fixtures)) {
    it(`holds after seeding and after every step: ${name}`, () => {
      const { geometry, nodes, sim } = rig(graph)

      expect(worstViolation(nodes, geometry)).toBeLessThanOrEqual(EPS)

      for (let i = 0; i < 60; i++) {
        step(sim, nodes, geometry)
        expect(worstViolation(nodes, geometry)).toBeLessThanOrEqual(EPS)
      }
    })
  }

  it('is violated by bare sim.tick(), which dispatches no tick event: the harness must run the same containment as the live view', () => {
    const { geometry, nodes, sim } = rig(fixtures['heavy cross-folder links']!)
    let worst = 0

    for (let i = 0; i < 30; i++) {
      sim.tick()
      worst = Math.max(worst, worstViolation(nodes, geometry))
    }

    expect(worst).toBeGreaterThan(1)
  })

  it('removes the outward normal velocity at the boundary and keeps the tangential part', () => {
    const comp = { dir: 'A', r: 50, x: 10, y: 10 }
    const node = { ...buildGraph([indexNote('A/a.md', '')]).nodes[0]!, vx: 3, vy: 4, x: 100, y: 10 } as SimNode

    expect(containNode(node, comp)).toBe(true)
    expect(node.x).toBeCloseTo(10 + 50 - radiusOf(node), 9)
    expect(node.vx).toBeCloseTo(0, 9)
    expect(node.vy).toBeCloseTo(4, 9)

    const inward = { ...node, vx: -2, vy: 0, x: 500, y: 10 } as SimNode

    containNode(inward, comp)
    expect(inward.vx).toBe(-2)
  })

  it('places a note whose radius equals its compartment at the centre, and never leaves a note outside', () => {
    const node = { ...buildGraph([indexNote('A/a.md', '')]).nodes[0]!, x: 40, y: -3 } as SimNode
    const tight = { dir: 'A', r: radiusOf(node), x: 5, y: 6 }

    containNode(node, tight)
    expect([node.x, node.y]).toEqual([5, 6])
    expect(clampToDisc({ r: 1, x: 0, y: 0 }, 9, 3, 3)).toEqual([0, 0])
  })

  it('survives a shrinking repack: relative offsets are mapped, then contained', () => {
    const big = rig(buildGraph(ring('A', 60)))

    for (let i = 0; i < 40; i++) {
      step(big.sim, big.nodes, big.geometry)
    }

    const oldComp = compartmentOf(big.geometry, 'A')!
    const offsets = big.nodes.map(node => toOffset(node, oldComp))
    const smallGraph = buildGraph(ring('A', 6))
    const geometry = computeGeometry(smallGraph.nodes)
    const comp = compartmentOf(geometry, 'A')!

    expect(comp.r).toBeLessThan(oldComp.r)

    // Without the containment pass a normalised offset near the rim would stick out of the smaller disc.
    const remapped: SimNode[] = smallGraph.nodes.map((node, i) => {
      const [, u, v] = offsets[i]!
      const [x, y] = fromOffset(comp, u, v)

      return { ...node, x, y }
    })

    containAll(remapped, geometry)
    expect(worstViolation(remapped, geometry)).toBeLessThanOrEqual(EPS)
  })

  it('survives note-radius growth that the stored offset cannot account for', () => {
    const geometry = computeGeometry(ring('A', 8).map(n => buildGraph([n]).nodes[0]!))
    const comp = compartmentOf(geometry, 'A')!
    const small = buildGraph([indexNote('A/a.md', '')]).nodes[0]!
    const grown = { ...small, degree: 60, x: comp.x + comp.r - radiusOf(small), y: comp.y } as SimNode

    expect(worstViolation([grown], geometry)).toBeGreaterThan(1)
    containAll([grown], geometry)
    expect(worstViolation([grown], geometry)).toBeLessThanOrEqual(EPS)
  })

  it('revalidates a pin target (fx/fy) and a drag target, not just the simulated position', () => {
    const { geometry, nodes, sim } = rig(fixtures['nested siblings']!)
    const pinned = nodes[7]!
    const comp = compartmentOf(geometry, pinned.dir)!

    // A pin carried from another layout, or from before the compartment shrank, lies far outside.
    pinned.fx = comp.x + 10_000
    pinned.fy = comp.y

    for (let i = 0; i < 5; i++) {
      step(sim, nodes, geometry)
      expect(worstViolation(nodes, geometry)).toBeLessThanOrEqual(EPS)
    }

    expect(Math.hypot(pinned.fx - comp.x, pinned.fy - comp.y)).toBeLessThanOrEqual(comp.r - radiusOf(pinned) + EPS)

    const [dx, dy] = clampToDisc(comp, radiusOf(pinned), comp.x - 777, comp.y - 777)

    expect(Math.hypot(dx - comp.x, dy - comp.y)).toBeLessThanOrEqual(comp.r - radiusOf(pinned) + EPS)
  })

  it('round-trips compartment-relative offsets', () => {
    const { geometry, nodes } = rig(fixtures['nested siblings']!)
    const node = nodes[20]!
    const comp = compartmentOf(geometry, node.dir)!
    const [dir, u, v] = toOffset(node, comp)
    const [x, y] = fromOffset(comp, u, v)

    expect(dir).toBe(comp.dir)
    expect([x, y]).toEqual([node.x, node.y].map(value => expect.closeTo(value, 9)))
  })
})
