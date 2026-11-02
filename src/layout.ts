/**
 * Note layout for the graph: the force simulation's configuration, and — in nested mode — the whole-note
 * containment that keeps every note inside its folder's compartment. Pure (no DOM), so the invariants
 * can be tested without painting.
 */

import {
  type Force,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'

import { type GraphNode, radiusOf } from './model'
import type { ClusterMode } from './prefs'
import { COLLIDE_PAD, compartmentOf, type Compartment, type Disc, type Geometry } from './regions'

export interface SimNode extends GraphNode, SimulationNodeDatum {
  x: number
  y: number
}

export type SimLink = SimulationLinkDatum<SimNode>

/** One anchor per folder, spread on a ring, so folders pull into clusters. */
export function folderAnchors(folders: readonly string[], mode: ClusterMode): Map<string, { x: number; y: number }> {
  const ring = mode === 'none' ? 0 : 170 + folders.length * 30

  return new Map(
    folders.map((folder, index) => {
      const angle = (index / Math.max(folders.length, 1)) * Math.PI * 2

      return [folder, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }]
    })
  )
}

/** The closest point to (x, y) at which a note of radius `r` lies wholly inside `disc` (its centre if `r` >= the disc's). */
export function clampToDisc(disc: Disc, r: number, x: number, y: number): [number, number] {
  const room = Math.max(0, disc.r - r)
  const dx = x - disc.x
  const dy = y - disc.y
  const d = Math.hypot(dx, dy)

  if (d <= room) {
    return [x, y]
  }

  return room === 0 || d === 0 ? [disc.x, disc.y] : [disc.x + (dx / d) * room, disc.y + (dy / d) * room]
}

/**
 * Put a note wholly inside its compartment and drop the outward part of its velocity if it was pushed
 * onto the boundary (keeping it would make every following step push against the same constraint).
 * A pin target (`fx`/`fy`) is revalidated the same way, since d3 reapplies it each step. Returns whether
 * anything moved. A note whose folder has no compartment is left alone.
 */
export function containNode(node: SimNode, compartment: Disc | undefined): boolean {
  if (!compartment) {
    return false
  }

  const r = radiusOf(node)
  let moved = false

  if (node.fx != null && node.fy != null) {
    const [fx, fy] = clampToDisc(compartment, r, node.fx, node.fy)

    moved = fx !== node.fx || fy !== node.fy
    node.fx = fx
    node.fy = fy
    node.x = fx
    node.y = fy
    node.vx = 0
    node.vy = 0

    return moved
  }

  const [x, y] = clampToDisc(compartment, r, node.x, node.y)

  if (x === node.x && y === node.y) {
    return false
  }

  node.x = x
  node.y = y

  const nx = x - compartment.x
  const ny = y - compartment.y
  const len = Math.hypot(nx, ny)
  const vx = node.vx ?? 0
  const vy = node.vy ?? 0

  if (len > 0) {
    const outward = (vx * nx + vy * ny) / len

    if (outward > 0) {
      node.vx = vx - (outward * nx) / len
      node.vy = vy - (outward * ny) / len
    }
  } else {
    node.vx = 0
    node.vy = 0
  }

  return true
}

/** `containNode` for every note; returns how many moved. */
export function containAll(nodes: readonly SimNode[], geometry: Geometry): number {
  let moved = 0

  for (const node of nodes) {
    if (containNode(node, compartmentOf(geometry, node.dir))) {
      moved++
    }
  }

  return moved
}

/** Evenly spread seed positions inside a compartment (a sunflower spiral), so a cold start never begins outside it. */
export function seedInCompartment(node: SimNode, compartment: Compartment, index: number, count: number): void {
  const room = Math.max(0, compartment.r - radiusOf(node)) * 0.85
  const radius = room * Math.sqrt((index + 0.5) / Math.max(count, 1))
  const angle = index * 2.399963229728653

  node.x = compartment.x + Math.cos(angle) * radius
  node.y = compartment.y + Math.sin(angle) * radius
}

/** A compartment-relative position: the compartment's folder plus the offset from its centre over its radius. */
export type Offset = [dir: string, u: number, v: number]

export const toOffset = (node: SimNode, compartment: Compartment): Offset => [
  compartment.dir,
  (node.x - compartment.x) / compartment.r,
  (node.y - compartment.y) / compartment.r
]

export const fromOffset = (compartment: Compartment, u: number, v: number): [number, number] => [
  compartment.x + u * compartment.r,
  compartment.y + v * compartment.r
]

export interface LayoutSpec {
  cluster: ClusterMode
  folders: readonly string[]
  geometry: Geometry
}

/*
 * Nested-mode tuning, from the boundary-crowding comparison in demo/bench.ts (600 notes, 300 steps; share of
 * notes in the outer 5% of a compartment). With the legacy 0.07 pull and 340 repulsion range, 61% of notes sat on
 * the rim with internal links only and 83% with no links at all: not cross-folder tension, but the repulsion pushing
 * outward against a weak pull. Shortening the range to 60 and pulling at 0.25 brings internal-only to 4% (and no-links
 * to 43%). Cross-folder links add a separate tension (65% at 70% cross-links). A second pass (live vault, notes hugging the
 * rim) found the cross-folder pull — proportional to a distance of hundreds — still beat the centring pull, and that plain
 * repulsion alone leaves 44% on the rim; so cross links are weakened to 0.03 and an inset spring eases notes off the rim
 * beyond half the usable radius (rim share 63% -> 10% at 70% cross-links, 27% -> 0% at 10%; mean radial fraction 0.5-0.6).
 * A third pass (live vault: notes clumped near the middle with the outer ring empty, hubs not central) widened the spacing:
 * weaker, longer intra-folder links (0.12 at 80), stronger and longer-ranged repulsion (250 within 110), the inset spring
 * starting at 0.8 of the usable radius, and a centring pull that grows with degree. On the bench's hub-and-spoke vault,
 * hubs sit at 0.38 of the compartment radius against 0.61 for the notes in the lower half by degree (0.45 vs 0.47 before),
 * and the mean radial fraction rises from 0.50 to 0.56 with 1% on the rim. Same force set, so the per-tick cost is unchanged.
 */
const NESTED_PULL = 0.25
const NESTED_REPULSION_RANGE = 110
const NESTED_LINK = 0.12
const NESTED_LINK_DISTANCE = 80
const NESTED_CHARGE = 250
/** Hubs are pulled to the centre harder: the centring strength grows by this per square root of degree (capped at 3). */
const HUB_PULL = 1.5
const CROSS_LINK = 0.03
/**
 * Notes are eased off the rim: beyond this share of the usable radius a spring pushes them back, so a settled
 * compartment reads as a filled disc rather than a ring. Gentle by design — the hard projection stays the guarantee.
 */
const INSET_START = 0.8
const INSET_STRENGTH = 2

function forceInset(geometry: Geometry): Force<SimNode, SimLink> {
  let nodes: SimNode[] = []

  const force = (alpha: number) => {
    for (const node of nodes) {
      const comp = compartmentOf(geometry, node.dir)

      if (!comp || node.fx != null) {
        continue
      }

      const room = Math.max(0, comp.r - radiusOf(node))
      const dx = node.x - comp.x
      const dy = node.y - comp.y
      const d = Math.hypot(dx, dy)
      const start = room * INSET_START

      if (d > start && d > 0) {
        const push = ((d - start) / d) * INSET_STRENGTH * alpha

        node.vx! -= dx * push
        node.vy! -= dy * push
      }
    }
  }

  force.initialize = (list: SimNode[]) => void (nodes = list)

  return force
}

/** The simulation. Nested mode pulls each note toward its compartment's centre instead of its folder's anchor. */
export function createSimulation(
  nodes: SimNode[],
  links: SimLink[],
  { cluster, folders, geometry }: LayoutSpec,
  alpha: number
): Simulation<SimNode, SimLink> {
  const anchors = folderAnchors(folders, cluster)
  const nested = cluster === 'nested'
  const pull = cluster === 'none' ? 0.02 : nested ? NESTED_PULL : 0.07

  const strength = (node: SimNode) => (nested ? pull * (1 + HUB_PULL * Math.min(3, Math.sqrt(node.degree))) : pull)

  const aim = (axis: 'x' | 'y') => (node: SimNode) =>
    nested ? (compartmentOf(geometry, node.dir)?.[axis] ?? 0) : (anchors.get(node.folder)?.[axis] ?? 0)

  const sim = forceSimulation<SimNode>(nodes)
    .alpha(alpha)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id(node => node.id)
        .distance(nested ? NESTED_LINK_DISTANCE : 48)
        .strength(link => (nested && (link.source as SimNode).dir !== (link.target as SimNode).dir ? CROSS_LINK : nested ? NESTED_LINK : 0.3))
    )
    .force('charge', forceManyBody<SimNode>().strength(nested ? -NESTED_CHARGE : -130).distanceMax(nested ? NESTED_REPULSION_RANGE : 340))
    .force('collide', forceCollide<SimNode>().radius(node => radiusOf(node) + COLLIDE_PAD))
    .force('x', forceX<SimNode>(aim('x')).strength(strength))
    .force('y', forceY<SimNode>(aim('y')).strength(strength))

  return nested ? sim.force('inset', forceInset(geometry)) : sim
}

/**
 * One step as the live view runs it: d3 dispatches `tick` after a step and the view contains the notes in
 * that handler, but a manual `sim.tick()` dispatches nothing, so harnesses call this instead.
 */
export function step(sim: Simulation<SimNode, SimLink>, nodes: readonly SimNode[], geometry: null | Geometry): void {
  sim.tick()

  if (geometry) {
    containAll(nodes, geometry)
  }
}
