/**
 * Nested folder regions: static, deterministic circle geometry for the vault's folder tree.
 *
 * A folder's direct notes form a *compartment* disc, a sibling of its subfolder discs; a note lives in
 * its folder's compartment, never in the folder disc itself. A folder disc is the enclosing circle of a
 * circle packing of its children, built bottom-up, so siblings are disjoint and children lie inside
 * parents by construction. Geometry is a pure function of the folder tree and per-compartment footprint
 * buckets (computed from the whole vault, never from what is displayed), so it is recomputed rather than
 * stored and does not change while notes settle or filters toggle.
 */

import { packEnclose, packSiblings } from 'd3-hierarchy'

import { type GraphNode, radiusOf } from './model'

export interface Disc {
  r: number
  x: number
  y: number
}

export interface Compartment extends Disc {
  dir: string
}

/** One drawn folder region. A chain of folders with no notes and a single child is one region. */
export interface Region extends Disc {
  children: string[]
  /** The notes' disc; coincides with `content` when the folder has no subfolders. */
  compartment: Compartment | null
  /** Disc holding everything inside the region (children and notes); the crescent between it and the region is the label band. */
  content: Disc
  depth: number
  /** The chain of folders this region stands for, outermost first; the last one is `id`. */
  dirs: string[]
  /** The deepest folder of the chain. */
  id: string
  /** Abbreviated path relative to the parent region. */
  label: string
  parent: null | string
  /** Top-level folder, for the hue. */
  top: string
}

export interface Geometry {
  /** Folder path -> id of the region it resolves to (every folder of the vault, chains included). */
  byDir: Map<string, string>
  compartments: Map<string, Compartment>
  /** Regions in parent-before-children order. */
  regions: Map<string, Region>
  root: null | string
  signature: string
  /** Radius of the smallest compartment that holds a note (0 when there is none). */
  smallest: number
}

/** The collision radius is `radiusOf + COLLIDE_PAD`; compartments are sized from the same footprint. */
export const COLLIDE_PAD = 4
/** Fraction of a compartment's area its notes' collision footprints may fill. Tuned by eye. */
const DENSITY = 0.4
/** Footprint buckets grow geometrically by this factor in area. Tuned by eye. */
const BUCKET_RATIO = 1.5
/** Gap kept between siblings (twice this) and between a child and its parent's edge. */
const REGION_PAD = 8
/**
 * Label band: the region disc is its content disc grown by this fraction of the content radius, with the content
 * pushed down to touch the bottom edge, leaving a crescent at the top (thickness twice this at the centre) that
 * only the region's label may occupy. Tuned by eye.
 */
const LABEL_BAND = 0.14
const BUCKET_ORIGIN = Math.PI * (radiusOf({ degree: 0 }) + COLLIDE_PAD) ** 2

export const EMPTY_GEOMETRY: Geometry = {
  byDir: new Map(),
  compartments: new Map(),
  regions: new Map(),
  root: null,
  signature: '',
  smallest: 0
}

/**
 * Compartment radius per folder with notes: the footprint area of its direct notes rounded UP into a
 * geometric bucket (a pure function of the current footprint, no hysteresis), divided by the packing
 * density, and never smaller than the largest note.
 */
export function compartmentRadii(nodes: readonly Pick<GraphNode, 'degree' | 'dir'>[]): Map<string, number> {
  const stats = new Map<string, { area: number; largest: number }>()

  for (const node of nodes) {
    const r = radiusOf(node) + COLLIDE_PAD
    const stat = stats.get(node.dir) ?? { area: 0, largest: 0 }

    stat.area += Math.PI * r * r
    stat.largest = Math.max(stat.largest, r)
    stats.set(node.dir, stat)
  }

  const radii = new Map<string, number>()

  for (const [dir, { area, largest }] of stats) {
    const bucket = Math.max(0, Math.ceil(Math.log(area / BUCKET_ORIGIN) / Math.log(BUCKET_RATIO) - 1e-9))
    const bucketed = BUCKET_ORIGIN * BUCKET_RATIO ** bucket

    radii.set(dir, Math.max(Math.sqrt(bucketed / (Math.PI * DENSITY)), largest))
  }

  return radii
}

/** Identity of a geometry's inputs, to skip recomputation when nothing that shapes the map changed. */
export const geometrySignature = (radii: ReadonlyMap<string, number>): string =>
  [...radii].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([dir, r]) => `${dir}\0${r.toFixed(4)}`).join('\n')

interface Packed {
  children: { dx: number; dy: number; packed: Packed }[]
  compartment: { dx: number; dy: number; r: number } | null
  content: { dx: number; dy: number; r: number }
  dirs: string[]
  r: number
}

const segments = (dir: string): string[] => (dir ? dir.split('/') : [])

const abbreviate = (path: string): string => {
  const parts = segments(path)

  return parts.length > 3 ? `${parts[0]}/…/${parts[parts.length - 1]}` : path
}

/** Region geometry for the folder compartments in `radii`. Deterministic: sorted paths, fixed tie-breaks. */
export function buildGeometry(radii: ReadonlyMap<string, number>): Geometry {
  if (radii.size === 0) {
    return EMPTY_GEOMETRY
  }

  const kids = new Map<string, Set<string>>([['', new Set()]])

  for (const dir of radii.keys()) {
    let current = dir

    while (current !== '') {
      const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''

      if (!kids.has(parent)) {
        kids.set(parent, new Set())
      }

      kids.get(parent)!.add(current)
      current = parent
    }
  }

  const pack = (dir: string): Packed => {
    const own = radii.get(dir)

    const items: { key: string; packed: null | Packed; r: number }[] = [
      ...(own === undefined ? [] : [{ key: '', packed: null, r: own }]),
      ...[...(kids.get(dir) ?? [])].sort().map(sub => {
        const packed = pack(sub)

        return { key: sub, packed, r: packed.r }
      })
    ]

    if (items.length === 1) {
      const [only] = items

      // A folder with notes and nothing else is its compartment; a folder with one child and no notes
      // is that child (a chain).
      if (only!.packed) {
        return { ...only!.packed, dirs: [dir, ...only!.packed.dirs] }
      }

      const band = dir === '' ? 0 : LABEL_BAND * own!

      return {
        children: [],
        compartment: { dx: 0, dy: band, r: own! },
        content: { dx: 0, dy: band, r: own! },
        dirs: [dir],
        r: own! + band
      }
    }

    // Largest first so the big discs sit at the centre; the key makes the order total.
    items.sort((a, b) => b.r - a.r || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    const circles = items.map(item => ({ r: item.r + REGION_PAD, x: 0, y: 0 }))

    packSiblings(circles)

    const enclosure = packEnclose(circles)
    const band = dir === '' ? 0 : LABEL_BAND * enclosure.r

    const result: Packed = {
      children: [],
      compartment: null,
      content: { dx: 0, dy: band, r: enclosure.r },
      dirs: [dir],
      r: enclosure.r + band
    }

    items.forEach((item, index) => {
      const dx = circles[index]!.x - enclosure.x
      const dy = circles[index]!.y - enclosure.y + band

      if (item.packed) {
        result.children.push({ dx, dy, packed: item.packed })
      } else {
        result.compartment = { dx, dy, r: item.r }
      }
    })

    return result
  }

  const regions = new Map<string, Region>()
  const byDir = new Map<string, string>()
  const compartments = new Map<string, Compartment>()

  const place = (packed: Packed, x: number, y: number, parent: null | Region, depth: number): Region => {
    const id = packed.dirs[packed.dirs.length - 1]!
    const first = packed.dirs.find(dir => dir !== '') ?? ''

    const region: Region = {
      children: [],
      compartment: null,
      content: { r: packed.content.r, x: x + packed.content.dx, y: y + packed.content.dy },
      depth,
      dirs: packed.dirs,
      id,
      label: abbreviate(parent ? id.slice(parent.id === '' ? 0 : parent.id.length + 1) : id),
      parent: parent?.id ?? null,
      r: packed.r,
      top: segments(first)[0] ?? '',
      x,
      y
    }

    regions.set(id, region)
    packed.dirs.forEach(dir => byDir.set(dir, id))
    parent?.children.push(id)

    if (packed.compartment) {
      const { dx, dy, r } = packed.compartment

      region.compartment = { dir: id, r, x: x + dx, y: y + dy }
      compartments.set(id, region.compartment)
    }

    for (const { dx, dy, packed: child } of packed.children) {
      place(child, x + dx, y + dy, region, depth + 1)
    }

    return region
  }

  const root = place(pack(''), 0, 0, null, 0)

  return {
    byDir,
    compartments,
    regions,
    root: root.id,
    signature: geometrySignature(radii),
    smallest: Math.min(...[...compartments.values()].map(c => c.r))
  }
}

export const computeGeometry = (nodes: readonly Pick<GraphNode, 'degree' | 'dir'>[]): Geometry =>
  buildGeometry(compartmentRadii(nodes))

/** The regions from the outermost to `id` (inclusive). */
export function regionChain(geometry: Geometry, id: null | string): Region[] {
  const chain: Region[] = []

  for (let current = id === null ? undefined : geometry.regions.get(id); current; ) {
    chain.unshift(current)
    current = current.parent === null ? undefined : geometry.regions.get(current.parent)
  }

  return chain
}

/** The region a note's folder resolves to. */
export const regionOfDir = (geometry: Geometry, dir: string): null | Region =>
  geometry.regions.get(geometry.byDir.get(dir) ?? '') ?? null

const contains = (disc: Disc, x: number, y: number): boolean => Math.hypot(x - disc.x, y - disc.y) <= disc.r

/**
 * The deepest region containing a world point. A child is entered only if `visible` accepts it (the
 * caller passes the draw test, so hit-testing agrees with what is on screen).
 */
export function regionAt(geometry: Geometry, x: number, y: number, visible: (region: Region) => boolean): null | Region {
  let current = geometry.root === null ? undefined : geometry.regions.get(geometry.root)

  if (!current || !contains(current, x, y)) {
    return null
  }

  for (;;) {
    const next: Region | undefined = current.children
      .map(id => geometry.regions.get(id)!)
      .find(child => contains(child, x, y) && visible(child))

    if (!next) {
      return current
    }

    current = next
  }
}

/** Where a note may be: its folder's compartment, less its own radius. */
export const compartmentOf = (geometry: Geometry, dir: string): Compartment | undefined => {
  const id = geometry.byDir.get(dir)

  return id === undefined ? undefined : geometry.compartments.get(id)
}
