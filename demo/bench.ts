// Bounded measurements for the nested layout (run with `node scripts/bench.mjs`): the simulation's force cost,
// the containment projection and geometry cost measured separately (manual sim.tick() — the `tick` event
// would not time forces), and boundary crowding with and without cross-folder links. Paint cost needs a
// browser and is measured by the harness (see scripts/bench.mjs).
import { createSimulation, containAll, seedInCompartment, type SimLink, type SimNode } from '../src/layout'
import { radiusOf, type VaultGraph } from '../src/model'
import { compartmentOf, computeGeometry } from '../src/regions'
import { syntheticGraph, type SyntheticOptions } from './synthetic'

function rig(graph: VaultGraph, cluster: 'folder' | 'nested') {
  const geometry = computeGeometry(graph.nodes)
  const seen = new Map<string, number>()
  const count = new Map<string, number>()

  graph.nodes.forEach(node => count.set(node.dir, (count.get(node.dir) ?? 0) + 1))

  const folders = [...new Set(graph.nodes.map(node => node.folder))].sort()

  const nodes: SimNode[] = graph.nodes.map((node, i) => {
    const index = seen.get(node.dir) ?? 0
    const placed: SimNode = { ...node, x: Math.cos(i) * 200, y: Math.sin(i) * 200 }

    seen.set(node.dir, index + 1)

    if (cluster === 'nested') {
      seedInCompartment(placed, compartmentOf(geometry, node.dir)!, index, count.get(node.dir)!)
    }

    return placed
  })

  const links: SimLink[] = graph.edges.map(e => ({ ...e }))
  const sim = createSimulation(nodes, links, { cluster, folders, geometry }, 1)

  sim.stop()

  return { geometry, nodes, sim }
}

const ms = (since: number) => performance.now() - since

function timing(label: string, options: SyntheticOptions, ticks = 60) {
  const graph = syntheticGraph(options)
  let t = performance.now()
  const geometry = computeGeometry(graph.nodes)
  const geometryMs = ms(t)
  const base = rig(graph, 'folder')

  t = performance.now()

  for (let i = 0; i < ticks; i++) {
    base.sim.tick()
  }

  const folderTick = ms(t) / ticks
  const nested = rig(graph, 'nested')
  let forces = 0
  let project = 0

  for (let i = 0; i < ticks; i++) {
    t = performance.now()
    nested.sim.tick()
    forces += ms(t)
    t = performance.now()
    containAll(nested.nodes, nested.geometry)
    project += ms(t)
  }

  console.log(
    `${label.padEnd(26)} N=${String(graph.nodes.length).padStart(5)} E=${String(graph.edges.length).padStart(5)} F=${String(geometry.regions.size).padStart(5)}` +
      `  geometry ${geometryMs.toFixed(1)}ms | tick: folder ${folderTick.toFixed(2)}ms, nested forces ${(forces / ticks).toFixed(2)}ms + projection ${(project / ticks).toFixed(3)}ms`
  )
}

/** Share of notes in the outer 10% of their compartment's usable radius, over compartments with >= 8 notes. */
function crowding(label: string, options: SyntheticOptions, steps = 300) {
  const graph = syntheticGraph(options)
  const { geometry, nodes, sim } = rig(graph, 'nested')

  for (let i = 0; i < steps; i++) {
    sim.tick()
    containAll(nodes, geometry)
  }

  const perDir = new Map<string, number>()

  nodes.forEach(node => perDir.set(node.dir, (perDir.get(node.dir) ?? 0) + 1))

  let rim = 0
  let total = 0
  let mean = 0

  for (const node of nodes) {
    if ((perDir.get(node.dir) ?? 0) < 8) {
      continue
    }

    const comp = compartmentOf(geometry, node.dir)!
    const frac = Math.hypot(node.x - comp.x, node.y - comp.y) / Math.max(comp.r - radiusOf(node), 1e-9)

    total++
    mean += frac
    rim += frac > 0.95 ? 1 : 0
  }

  console.log(`${label.padEnd(34)} notes in big compartments ${total}: at rim ${((100 * rim) / total).toFixed(0)}%, mean radial fraction ${(mean / total).toFixed(2)}`)
}

const base = { branching: 3, depth: 3, links: 2, skew: 0.7 }

console.log('--- boundary crowding (nested, 300 settled steps)')
crowding('internal links only', { ...base, crossFraction: 0, notes: 600, seed: 2 })
crowding('10% cross-folder', { ...base, crossFraction: 0.1, notes: 600, seed: 2 })
crowding('70% cross-folder', { ...base, crossFraction: 0.7, notes: 600, seed: 2 })
crowding('no links at all', { ...base, links: 0, notes: 600, seed: 2 })

console.log('--- cost (manual ticks; 60-tick means)')
timing('N=500', { ...base, notes: 500 })
timing('N=2000', { ...base, notes: 2000 })
timing('N=5000', { ...base, depth: 4, notes: 5000 })
timing('folder-per-note N=1500', { folderPerNote: true, depth: 3, links: 2, notes: 1500 })
