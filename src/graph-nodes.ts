/**
 * The graph's note set as the view builds it: simulation nodes seeded from live, remembered or fresh positions,
 * adjacency, the nested layout's saved offsets, and keyboard hops. Pure (no DOM), so the view only wires it.
 */

import { type Offset, fromOffset, type SimLink, type SimNode, seedInCompartment, toOffset } from './layout'
import type { VaultGraph } from './model'
import type { ClusterMode } from './prefs'
import { type Compartment, compartmentOf, type Geometry, regionOfDir } from './regions'

export interface SeedSpec {
  /** Where each folder pulls its notes (see `folderAnchors`). */
  anchors: ReadonlyMap<string, { x: number; y: number }>
  cluster: ClusterMode
  geometry: Geometry
  graph: VaultGraph
  /** Compartment-relative positions remembered for the nested layout. */
  nestedPositions: Record<string, Offset>
  pinned: ReadonlySet<string>
  /** The live nodes and the layout they belong to, if the previous layout is the same mode (else positions are meaningless). */
  previous: ReadonlyMap<string, SimNode>
  previousGeometry: Geometry | undefined
  /** Absolute positions remembered for the free layouts, or undefined when saved under another layout. */
  saved: Record<string, [number, number]> | undefined
}

/**
 * Nodes for `spec.graph`, each at the best position known: live (carried through a repack by compartment offset in
 * nested mode), else remembered, else seeded near its folder's anchor or inside its compartment. `restored` counts
 * the nodes that had one. Pinned notes are fixed where they start.
 */
export function seedNodes(spec: SeedSpec): { nodes: SimNode[]; restored: number } {
  const { anchors, cluster, geometry, graph, nestedPositions, pinned, previous, previousGeometry, saved } = spec
  const nested = cluster === 'nested'
  const perDir = new Map<string, number>()

  for (const node of graph.nodes) {
    perDir.set(node.dir, (perDir.get(node.dir) ?? 0) + 1)
  }

  const seen = new Map<string, number>()
  let restored = 0

  const nodes = graph.nodes.map(node => {
    const index = seen.get(node.dir) ?? 0

    seen.set(node.dir, index + 1)

    const comp = nested ? compartmentOf(geometry, node.dir) : undefined
    const old = previous.get(node.id)
    let known: undefined | { x: number; y: number }

    if (nested) {
      // Compartment-relative: carried through a repack by offset, then contained by the caller.
      const oldComp = old && previousGeometry ? compartmentOf(previousGeometry, old.dir) : undefined
      const stored = nestedPositions[node.id]

      if (comp && old && oldComp && old.dir === node.dir) {
        const [x, y] = fromOffset(comp, (old.x - oldComp.x) / oldComp.r, (old.y - oldComp.y) / oldComp.r)

        known = { x, y }
      } else if (comp && !old && stored && stored[0] === node.dir) {
        const [x, y] = fromOffset(comp, stored[1], stored[2])

        known = { x, y }
      }
    } else if (old) {
      known = old
    } else if (saved?.[node.id]) {
      known = { x: saved[node.id]![0], y: saved[node.id]![1] }
    }

    if (known) {
      restored++
    }

    const anchor = anchors.get(node.folder) ?? { x: 0, y: 0 }

    const placed: SimNode = {
      ...node,
      x: known?.x ?? anchor.x + (Math.random() - 0.5) * 40,
      y: known?.y ?? anchor.y + (Math.random() - 0.5) * 40
    }

    if (comp && !known) {
      seedInCompartment(placed, comp, index, perDir.get(node.dir) ?? 1)
    }

    if (pinned.has(node.id)) {
      placed.fx = placed.x
      placed.fy = placed.y
    }

    return placed
  })

  return { nodes, restored }
}

/** Regions that hold at least one of `nodes`, with every ancestor of such a region. */
export function occupiedRegions(nodes: readonly SimNode[], geometry: Geometry): Set<string> {
  const occupied = new Set<string>()

  for (const node of nodes) {
    for (let region = regionOfDir(geometry, node.dir); region && !occupied.has(region.id); ) {
      occupied.add(region.id)
      region = region.parent === null ? null : (geometry.regions.get(region.parent) ?? null)
    }
  }

  return occupied
}

/** Every note's compartment-relative position, rounded for storage; notes whose folder has no compartment are left out. */
export function nestedOffsets(nodes: readonly SimNode[], geometry: Geometry): Record<string, Offset> {
  const round = (value: number) => Math.round(value * 1e4) / 1e4
  const offsets: Record<string, Offset> = {}

  for (const node of nodes) {
    const comp: Compartment | undefined = compartmentOf(geometry, node.dir)

    if (comp) {
      const [dir, u, v] = toOffset(node, comp)

      offsets[node.id] = [dir, round(u), round(v)]
    }
  }

  return offsets
}

/** Note id → the ids it shares a link with, in either direction. */
export function adjacencyOf(links: readonly SimLink[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()

  const add = (from: string, to: string) => {
    const list = adjacency.get(from)

    if (list) {
      list.push(to)
    } else {
      adjacency.set(from, [to])
    }
  }

  for (const link of links) {
    const source = (link.source as SimNode).id
    const target = (link.target as SimNode).id

    add(source, target)
    add(target, source)
  }

  return adjacency
}

const HOPS: Record<string, [number, number]> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1]
}

/**
 * The note an arrow key hops to from `from`: among its linked notes (all notes if it has none), the one best aligned
 * with the direction (within about 72° of it), favouring the nearer. Null for a key that is not an arrow or no candidate.
 */
export function hopTarget(key: string, from: SimNode, nodes: readonly SimNode[], adjacency: ReadonlyMap<string, readonly string[]>): null | SimNode {
  const dir = HOPS[key]

  if (!dir) {
    return null
  }

  const linked = adjacency.get(from.id)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const pool = linked?.length ? linked.map(id => byId.get(id)).filter((node): node is SimNode => node !== undefined) : nodes
  let best: null | SimNode = null
  let bestScore = -Infinity

  for (const node of pool) {
    if (node.id === from.id) {
      continue
    }

    const vx = node.x - from.x
    const vy = node.y - from.y
    const len = Math.hypot(vx, vy) || 1
    const alignment = (vx * dir[0] + vy * dir[1]) / len

    if (alignment > 0.3 && alignment / (1 + len / 200) > bestScore) {
      best = node
      bestScore = alignment / (1 + len / 200)
    }
  }

  return best
}
