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
 * Nested-mode tuning, from the crowding comparisons in demo/bench.ts (settled notes, by compartment size and link
 * locality). What moves a note inside its compartment, and why each force is there:
 *  - repulsion, per compartment only (forceCompartmentCharge), weaker for folders of under a dozen notes: a global range let a neighbouring crowd push a small
 *    folder's notes onto its wall (singletons 90% on the rim), and no one range suits both a 3-note and a 300-note folder;
 *  - intra-folder links only (sameFolderLinks): a cross-folder link is a spring over hundreds of units, which beats
 *    every centring force whatever the compartment's size, so it parked notes on the wall facing their partner;
 *  - a linear pull to the centre, stronger for hubs, so well-connected notes sit inward;
 *  - an inset spring beyond 0.8 of the usable radius. It matters only for notes with no links, which repulsion alone
 *    leaves on the rim (90% -> 69% in the bench's no-links case); with links the pull already keeps them in;
 *  - the hard containment projection, which is the guarantee; none of the above is relied on for it.
 * Measured on the bench (beyond 0.8 of the usable radius is 36% of a disc's area, so ~36-40% there is a uniform fill, not
 * rim-hugging): notes of folders with 1-7 notes 0-7%, of 8+ notes 40%; hubs at about 0.3 of the radius, others about 0.7
 * (uniform fill is 0.67); any share of cross-folder links gives the same result, since they no longer move notes.
 */
const NESTED_PULL = 0.25
const NESTED_LINK = 0.12
const NESTED_LINK_DISTANCE = 80
const NESTED_CHARGE = 250
/** A folder with fewer notes than this repels with a proportionally weaker force: a handful of notes need no pushing apart to fill a small disc. */
const CHARGE_FULL_AT = 12
/** Hubs are pulled to the centre harder: the centring strength grows by this per square root of degree (capped at 3). */
const HUB_PULL = 1.5
/**
 * Notes are eased off the rim: beyond this share of the usable radius a spring pushes them back, so a settled
 * compartment reads as a filled disc rather than a ring. Gentle by design — the hard projection stays the guarantee.
 */
const INSET_START = 0.8
const INSET_STRENGTH = 2

/**
 * Repulsion within each compartment only. Notes of different folders are already apart by construction (the
 * compartments are disjoint), so a global many-body force only let a neighbouring crowd shove a small folder's
 * notes onto its wall. One many-body force per compartment, each over that compartment's notes: cheaper than one
 * over all of them, and its range is the compartment's own size instead of a number tuned for the largest.
 */
function forceCompartmentCharge(geometry: Geometry, strength: number): Force<SimNode, SimLink> {
  let groups: Force<SimNode, SimLink>[] = []

  const force = (alpha: number) => groups.forEach(group => group(alpha))

  force.initialize = (nodes: SimNode[], random: () => number) => {
    const byDir = new Map<string, SimNode[]>()

    for (const node of nodes) {
      const members = byDir.get(node.dir)

      if (members) {
        members.push(node)
      } else {
        byDir.set(node.dir, [node])
      }
    }

    groups = [...byDir]
      .filter(([, members]) => members.length > 1)
      .map(([dir, members]) => {
        const many = forceManyBody<SimNode>().strength(-strength * Math.min(1, members.length / CHARGE_FULL_AT)).distanceMax(2 * (compartmentOf(geometry, dir)?.r ?? Infinity))

        many.initialize(members, random)

        return many
      })
  }

  return force
}

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

/**
 * Nested mode lays out only the links inside a folder. A link to another folder is a spring over a distance of
 * hundreds of units whatever the compartments' size, so it beats every centring force and parks the note on its
 * wall facing the partner (worst in small folders). Those links are still drawn; they just do not move notes.
 */
function sameFolderLinks(nodes: readonly SimNode[], links: readonly SimLink[]): SimLink[] {
  const dirs = new Map(nodes.map(node => [node.id, node.dir]))
  const dirOf = (end: SimLink['source']) => dirs.get(typeof end === 'object' ? (end as SimNode).id : String(end))

  return links.filter(link => dirOf(link.source) === dirOf(link.target))
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
      forceLink<SimNode, SimLink>(nested ? sameFolderLinks(nodes, links) : links)
        .id(node => node.id)
        .distance(nested ? NESTED_LINK_DISTANCE : 48)
        .strength(nested ? NESTED_LINK : 0.3)
    )
    .force('charge', nested ? forceCompartmentCharge(geometry, NESTED_CHARGE) : forceManyBody<SimNode>().strength(-130).distanceMax(340))
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
