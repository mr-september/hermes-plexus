/**
 * Canvas painting for the graph: region discs and labels, edges, notes and note labels. Everything here is a
 * function of a `Scene` snapshot and a 2D context already transformed into world space, so the component keeps
 * only the state and the events.
 */

import type { View } from './camera'
import { type DrawnEdge, segmentInView } from './edges'
import { isHiddenDir } from './hidden'
import type { SimNode } from './layout'
import { matchesSearch, radiusOf } from './model'
import type { LabelMode } from './prefs'
import { type Geometry, type Region, regionChain } from './regions'

/** Notes changed by something else stay highlighted this long. */
export const TOUCHED_MS = 10 * 60 * 1000

/** A region is drawn (and can be hit) once its on-screen radius reaches this, and its label once it reaches the second. */
export const REGION_MIN_PX = 14
const LABEL_MIN_PX = 20
/**
 * Region labels are 11px, shrinking with the region to this floor. A label that does not fit the crescent above the
 * content (which needs a region of about 60px radius for 11px text) is drawn at the floor, haloed, over the
 * region's top instead — from LABEL_MIN_PX up, where the notes beneath are a few pixels each.
 */
const LABEL_COMPACT_PX = 9

/** Stroke alpha of each edge class in the nested layout; the across class is the faintest, so structure reads first. */
const EDGE_ALPHA = { across: 0.15, compartment: 0.5, top: 0.28 } as const
/** Paint order, faintest first. */
const EDGE_ORDER = ['flat', 'across', 'top', 'compartment'] as const
/** Non-incident edges keep this share of their strength while a note is focused. */
const EDGE_RECEDE = 0.25
/** At most this many note labels are considered per paint. */
const MAX_NOTE_LABELS = 400

export type Box = [number, number, number, number]

export interface LabelBox {
  box: Box
  id: string
}

/** What a paint reads. Built per frame from the component's refs and props. */
export interface Scene {
  accent: string
  canvas: HTMLCanvasElement
  /** Region the camera is in, and the region under the pointer. */
  currentRegion: null | string
  edges: readonly DrawnEdge<SimNode>[]
  /** Draw edges at all. */
  edgesOn: boolean
  /** The focused note: hovered, else keyboard cursor, else selected. */
  focus: null | string
  geometry: Geometry
  hiddenFolders: ReadonlySet<string>
  hiddenSuffix: string
  hoverRegion: null | string
  hueOf: (folder: string) => number
  ink: string
  labelMode: LabelMode
  muted: string
  /** The focus and its linked notes. */
  near: ReadonlySet<string>
  nested: boolean
  nodes: readonly SimNode[]
  /** Regions that hold a shown note: the rest are drawn faintly. */
  occupied: ReadonlySet<string>
  openRels: ReadonlySet<string>
  pinned: ReadonlySet<string>
  search: string
  selected: null | string
  size: { h: number; w: number }
  /** Style edges by class (the local graph draws them all alike). */
  tierEdges: boolean
  touched: Record<string, number>
  view: View
}

export const fontOf = (px: number, weight: 400 | 600): string =>
  `${weight} ${px}px "Segoe UI", system-ui, -apple-system, sans-serif`

export const hsl = (hue: number, lightness: number): string => `hsl(${hue} 62% ${lightness}%)`

const overlaps = (a: readonly number[], b: readonly number[]): boolean => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!

/** Whether the box lies wholly outside the disc grown by `margin`. */
const rectClearOf = (box: readonly number[], disc: { r: number; x: number; y: number }, margin: number): boolean =>
  Math.hypot(Math.max(box[0]!, Math.min(disc.x, box[2]!)) - disc.x, Math.max(box[1]!, Math.min(disc.y, box[3]!)) - disc.y) >=
  disc.r + margin

/** The first opaque background above the canvas, so a haloed label cuts a clean edge in any theme. */
function haloColor(canvas: HTMLCanvasElement): string {
  for (let el: Element | null = canvas; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor

    if (bg && !/^rgba?\(.*,\s*0\)$|^transparent$/.test(bg)) {
      return bg
    }
  }

  return 'rgba(0, 0, 0, 0.55)'
}

/** The world-space rectangle the viewport shows. */
const viewport = ({ size: { h, w }, view: { k, x, y } }: Scene) => ({ bottom: (h - y) / k, left: -x / k, right: (w - x) / k, top: -y / k })

/** Region discs and their labels. Labels placed here go into `placed`, so notes yield to them; returns their hit boxes. */
export function paintRegions(ctx: CanvasRenderingContext2D, scene: Scene, placed: Box[]): LabelBox[] {
  const { currentRegion, geometry: geo, hiddenFolders, hoverRegion: focusId, hueOf, ink, occupied } = scene
  const { k } = scene.view
  const { bottom, left, right, top } = viewport(scene)
  const root = geo.root === null ? undefined : geo.regions.get(geo.root)
  const chain = new Set(focusId === null ? [] : regionChain(geo, focusId).map(region => region.id))
  const fontPx = 11 / k
  const labelBoxes: LabelBox[] = []
  let halo: null | string = null

  ctx.font = fontOf(fontPx, 600)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const disc = (cx: number, cy: number, r: number, hue: number, depth: number, lit: boolean, empty: boolean, own: boolean, dashed: boolean) => {
    const recede = focusId !== null && !lit
    const faint = empty ? 0.35 : 1

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.globalAlpha = (own ? 0.05 : 0.16 / (1 + 0.45 * depth)) * (lit ? 1.7 : recede ? 0.45 : 1) * faint
    ctx.fillStyle = hsl(hue, Math.min(72, 50 + 4 * depth))
    ctx.fill()
    // A hidden region's dashed outline keeps full strength so it stays readable while its fill is faint.
    ctx.globalAlpha = (lit ? 0.85 : recede ? 0.12 : 0.32) * (dashed ? 1 : faint)
    ctx.strokeStyle = hsl(hue, Math.min(72, 54 + 4 * depth))
    ctx.lineWidth = (lit ? 1.8 : 1) / k

    if (dashed) {
      ctx.setLineDash([5 / k, 4 / k])
    }

    ctx.stroke()

    if (dashed) {
      ctx.setLineDash([])
    }
  }

  const label = (region: Region, text: string, lit: boolean, forced: boolean) => {
    // Where `text` sits at `px` screen pixels: in the top of the region, as high as the circle's curve allows.
    const lay = (px: number) => {
      ctx.font = fontOf(px / k, 600)

      const width = ctx.measureText(text).width
      const half = width / 2 + 3 / k
      const room = region.r > half ? region.r - Math.sqrt(region.r * region.r - half * half) : region.r
      const y = region.y - region.r + Math.max(3 / k, room)

      return { box: [region.x - width / 2, y, region.x + width / 2, y + (px / k) * 1.15] as Box, room, width }
    }

    const s = region.r * k
    // The crescent above the content disc holds no note or child region, so a label that fits there is drawn
    // as it is. The text shrinks with the region before it gives up on the crescent.
    const sized = lay(Math.min(11, Math.max(LABEL_COMPACT_PX, s / 5)))
    const clear = sized.room < region.r && rectClearOf(sized.box, region.content, 2 / k)
    const overlay = forced || clear ? null : lay(LABEL_COMPACT_PX)
    const spot = forced || clear ? sized : overlay && overlay.width <= 1.5 * region.r ? overlay : null

    if (spot && (forced || !placed.some(p => overlaps(spot.box, p)))) {
      const { box } = spot

      placed.push(box)
      labelBoxes.push({ box: [box[0] - 2 / k, box[1] - 2 / k, box[2] + 2 / k, box[3] + 2 / k], id: region.id })
      ctx.globalAlpha = lit || forced ? 1 : focusId !== null ? 0.4 : 0.85

      if (spot === overlay) {
        halo ??= haloColor(scene.canvas)
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = halo
        ctx.strokeText(text, region.x, box[1])
      }

      ctx.fillStyle = ink
      ctx.fillText(text, region.x, box[1])
    }

    ctx.font = fontOf(fontPx, 600)
  }

  // A region whose children are not drawn yet is a plain disc; labels need room to be legible.
  const visit = (region: Region) => {
    const s = region.r * k

    if (s < REGION_MIN_PX || region.x + region.r < left || region.x - region.r > right || region.y + region.r < top || region.y - region.r > bottom) {
      return
    }

    const hue = hueOf(region.top)
    const lit = chain.has(region.id)

    const covers = [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom]
    ].every(([px, py]) => Math.hypot(px! - region.x, py! - region.y) < region.r)

    // Above the band (the region has outgrown the viewport) only the outline — which is off screen — remains.
    // The vault root stays in the geometry (it holds the packing together and anchors the camera fits and
    // the breadcrumb) but is not drawn: its disc is only the enclosure of the top-level folders.
    // A region is hidden by saved path coverage (its own entry or an ancestor's), not by having no shown note.
    const hidden = region.id !== '' && isHiddenDir(hiddenFolders, region.id)
    const empty = !occupied.has(region.id)

    if (!covers && region.id !== '') {
      disc(region.x, region.y, region.r, hue, region.depth, lit, empty, false, hidden)
    }

    const comp = region.compartment

    // A folder's own notes float among its subfolders' discs: their compartment is a packing device, not a drawn
    // container. Only the vault root's, when its notes are hidden, is outlined (dashed), as the sign of that.
    if (comp && region.id === '' && hiddenFolders.has('') && region.children.length && comp.r * k >= REGION_MIN_PX) {
      disc(comp.x, comp.y, comp.r, hue, region.depth + 1, lit, empty, true, true)
    }

    const forced = region.id === focusId || region.id === currentRegion

    if (region.label && !covers && (s >= LABEL_MIN_PX || forced)) {
      label(region, hidden ? `${region.label} ${scene.hiddenSuffix}` : region.label, lit, forced)
    }

    for (const id of region.children) {
      visit(geo.regions.get(id)!)
    }
  }

  if (root) {
    visit(root)
  }

  ctx.globalAlpha = 1
  ctx.lineWidth = 1 / k

  return labelBoxes
}

/** Edges grouped by class and colour into one path each, faintest first; the focused note's edges last. */
export function paintEdges(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { accent, focus, hueOf, muted, tierEdges } = scene
  const { k } = scene.view
  const view = viewport(scene)
  const margin = 1 / k
  const incident: DrawnEdge<SimNode>[] = []
  const groups = new Map<string, { alpha: number; color: string; edges: DrawnEdge<SimNode>[]; rank: number }>()

  for (const edge of scene.edges) {
    if (!segmentInView(edge.source, edge.target, view, margin)) {
      continue
    }

    if (focus !== null && (edge.source.id === focus || edge.target.id === focus)) {
      incident.push(edge)

      continue
    }

    // Untiered (the local graph): every edge alike, neutral. Tiered: by class, tinted unless across folders.
    const hue = hueOf(edge.source.folder)
    const cls = tierEdges ? edge.class : 'flat'
    const neutral = cls === 'across' || cls === 'flat'
    const key = neutral ? cls : `${cls}:${hue}`
    let group = groups.get(key)

    if (!group) {
      group = {
        alpha: (cls === 'flat' ? 0.35 : EDGE_ALPHA[cls]) * (focus === null ? 1 : EDGE_RECEDE),
        color: neutral ? muted : hsl(hue, 58),
        edges: [],
        rank: EDGE_ORDER.indexOf(cls)
      }
      groups.set(key, group)
    }

    group.edges.push(edge)
  }

  const stroke = (edges: readonly DrawnEdge<SimNode>[], color: string, alpha: number) => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.beginPath()

    for (const { source, target } of edges) {
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }

    ctx.stroke()
  }

  // Faintest class first, so the local structure is never painted over.
  for (const group of [...groups.values()].sort((p, q) => p.rank - q.rank)) {
    stroke(group.edges, group.color, group.alpha)
  }

  stroke(incident, accent, 0.9)
}

/** Note discs with their markers: recently touched (dashed halo), open or selected (ring), pinned (tick). */
export function paintNodes(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { accent, focus, hueOf, ink, near, openRels, pinned, search, selected, touched } = scene
  const { k } = scene.view
  const searching = search.trim().length > 0
  const now = Date.now()

  for (const node of scene.nodes) {
    const dim = (focus !== null && !near.has(node.id)) || (searching && !matchesSearch(node, search))
    const r = radiusOf(node)
    const touchedAt = touched[node.id]

    ctx.globalAlpha = dim ? 0.16 : 1
    ctx.fillStyle = hsl(hueOf(node.folder), 58)
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fill()

    if (touchedAt !== undefined && now - touchedAt < TOUCHED_MS) {
      ctx.globalAlpha = dim ? 0.3 : 0.9
      ctx.strokeStyle = accent
      ctx.setLineDash([2 / k, 2 / k])
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 6 / k, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (openRels.has(node.id) || node.id === selected) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = accent
      ctx.lineWidth = 2 / k
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 3 / k, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1 / k
    }

    if (pinned.has(node.id)) {
      ctx.globalAlpha = dim ? 0.3 : 1
      ctx.fillStyle = ink
      ctx.fillRect(node.x - 1.5 / k, node.y - r - 5 / k, 3 / k, 3 / k)
    }
  }
}

/**
 * Note labels. A canvas font cannot use CSS variables, so the families are named outright; the size is divided by
 * the zoom so the text stays ~11px on screen. Highest-priority labels are placed first and any that would overlap
 * an already placed one are skipped, so a dense graph stays legible.
 */
export function paintNoteLabels(ctx: CanvasRenderingContext2D, scene: Scene, placed: Box[]): void {
  const { focus, ink, labelMode, near, search } = scene
  const { k } = scene.view
  const searching = search.trim().length > 0
  const fontPx = 11 / k

  ctx.fillStyle = ink
  ctx.font = fontOf(fontPx, 400)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const priority = (node: SimNode, matched: boolean): number =>
    node.id === focus ? 1e6 : near.has(node.id) ? 1e5 + node.degree : matched ? 1e4 + node.degree : node.degree

  const candidates = scene.nodes
    .map(node => ({ matched: searching && matchesSearch(node, search), node }))
    .filter(({ matched, node }) => {
      if (labelMode === 'never') {
        return node.id === focus
      }

      if (focus !== null && !near.has(node.id) && !matched) {
        return false
      }

      return labelMode === 'always' || node.id === focus || near.has(node.id) || matched || node.degree >= 6 || k > 1.2
    })
    .sort((a, b) => priority(b.node, b.matched) - priority(a.node, a.matched))
    .slice(0, MAX_NOTE_LABELS)

  for (const { matched, node } of candidates) {
    const width = ctx.measureText(node.title).width
    const left = node.x - width / 2
    const top = node.y + radiusOf(node) + 2 / k
    const box: Box = [left, top, left + width, top + fontPx * 1.15]

    if (node.id !== focus && placed.some(p => overlaps(box, p))) {
      continue
    }

    placed.push(box)
    ctx.globalAlpha = node.id === focus ? 1 : matched || near.has(node.id) ? 0.95 : 0.8
    ctx.fillText(node.title, node.x, top)
  }
}
