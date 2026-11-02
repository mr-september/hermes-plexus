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

/** Every folder gets two hubs that most of its notes link to: the star shapes real vaults grow around index notes. */
function hubAndSpoke(graph: VaultGraph): VaultGraph {
  const byDir = new Map<string, string[]>()

  graph.nodes.forEach(node => byDir.set(node.dir, [...(byDir.get(node.dir) ?? []), node.id]))

  const edges = [...graph.edges]
  let k = 0

  for (const ids of byDir.values()) {
    ids.slice(2).forEach((id, i) => {
      if ((k++ * 7) % 10 < 7) {
        edges.push({ source: id, target: ids[i % 2]! })
      }
    })
  }

  const degree = new Map<string, number>()

  for (const { source, target } of edges) {
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  return { edges, nodes: graph.nodes.map(node => ({ ...node, degree: degree.get(node.id) ?? 0 })) }
}

/** Share of notes in the outer 10% of their compartment's usable radius, over compartments with >= 8 notes. */
function crowding(label: string, options: SyntheticOptions, steps = 300, hubs = false) {
  const graph = hubs ? hubAndSpoke(syntheticGraph(options)) : syntheticGraph(options)
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

  // Hub placement and spacing, per compartment with >= 8 notes: radial fraction of the top-quartile-degree notes against
  // the bottom half, and mean nearest-neighbour distance over the random-uniform expectation (1 = as spread as chance, < 1 clumped).
  const byDir = new Map<string, SimNode[]>()

  nodes.forEach(node => byDir.set(node.dir, [...(byDir.get(node.dir) ?? []), node]))

  let hubSum = 0
  let hubN = 0
  let leafSum = 0
  let leafN = 0
  let spread = 0
  let spreadN = 0

  for (const [dir, group] of byDir) {
    if (group.length < 8) {
      continue
    }

    const comp = compartmentOf(geometry, dir)!
    const sorted = [...group].sort((a, b) => b.degree - a.degree)
    const frac = (node: SimNode) => Math.hypot(node.x - comp.x, node.y - comp.y) / comp.r

    sorted.slice(0, Math.ceil(group.length / 4)).forEach(node => ((hubSum += frac(node)), hubN++))
    sorted.slice(Math.floor(group.length / 2)).forEach(node => ((leafSum += frac(node)), leafN++))

    const ideal = 0.5 * Math.sqrt((Math.PI * comp.r * comp.r) / group.length)

    for (const node of group) {
      spread += Math.min(...group.filter(o => o !== node).map(o => Math.hypot(o.x - node.x, o.y - node.y))) / ideal
      spreadN++
    }
  }

  console.log(`  hubs r/R ${(hubSum / hubN).toFixed(2)} vs leaves ${(leafSum / leafN).toFixed(2)}; nearest-neighbour spacing ${(spread / spreadN).toFixed(2)} x uniform-random`)
  console.log(`${label.padEnd(34)} notes in big compartments ${total}: at rim ${((100 * rim) / total).toFixed(0)}%, mean radial fraction ${(mean / total).toFixed(2)}`)
}

/** Rim share (beyond 0.8 of the usable radius) by compartment size: small compartments have almost no room, so any steady pull reaches the wall. */
function bySize(label: string, options: SyntheticOptions, steps = 300) {
  const { geometry, nodes, sim } = rig(syntheticGraph(options), 'nested')

  for (let i = 0; i < steps; i++) {
    sim.tick()
    containAll(nodes, geometry)
  }

  const perDir = new Map<string, number>()

  nodes.forEach(node => perDir.set(node.dir, (perDir.get(node.dir) ?? 0) + 1))

  const classes = { '1': [0, 0], '2-3': [0, 0], '4-7': [0, 0], '8+': [0, 0] } as Record<string, [number, number]>

  for (const node of nodes) {
    const n = perDir.get(node.dir)!
    const comp = compartmentOf(geometry, node.dir)!
    const frac = Math.hypot(node.x - comp.x, node.y - comp.y) / Math.max(comp.r - radiusOf(node), 1e-9)
    const cls = classes[n === 1 ? '1' : n < 4 ? '2-3' : n < 8 ? '4-7' : '8+']!

    cls[1]++
    cls[0] += frac > 0.8 ? 1 : 0
  }

  console.log(
    `${label.padEnd(34)} beyond 0.8 of room, by notes per folder: ` +
      Object.entries(classes).map(([name, [rim, total]]) => `${name}: ${total ? Math.round((100 * rim) / total) : '-'}% (n=${total})`).join(', ')
  )
}

const base = { branching: 3, depth: 3, links: 2, skew: 0.7 }

console.log('--- boundary crowding (nested, 300 settled steps)')
crowding('internal links only', { ...base, crossFraction: 0, notes: 600, seed: 2 })
crowding('10% cross-folder', { ...base, crossFraction: 0.1, notes: 600, seed: 2 })
crowding('70% cross-folder', { ...base, crossFraction: 0.7, notes: 600, seed: 2 })
crowding('hub-and-spoke, 10% cross', { ...base, crossFraction: 0.1, notes: 600, seed: 2 }, 300, true)
crowding('no links at all', { ...base, links: 0, notes: 600, seed: 2 })

console.log('--- small compartments')
bySize('30% cross, many small folders', { ...base, branching: 4, crossFraction: 0.3, depth: 3, notes: 300, seed: 3, skew: 1.2 })
bySize('10% cross, many small folders', { ...base, branching: 4, crossFraction: 0.1, depth: 3, notes: 300, seed: 3, skew: 1.2 })

console.log('--- cost (manual ticks; 60-tick means)')
timing('N=500', { ...base, notes: 500 })
timing('N=2000', { ...base, notes: 2000 })
timing('N=5000', { ...base, depth: 4, notes: 5000 })
timing('folder-per-note N=1500', { folderPerNote: true, depth: 3, links: 2, notes: 1500 })
