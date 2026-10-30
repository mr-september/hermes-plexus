import type { Simulation } from 'd3-force'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon, usePluginI18n } from '@hermes/plugin-sdk'

import { clampScale, frameDisc, type View, zoomLimits, zoomPath } from './camera'
import { PLUGIN_ID } from './i18n'
import {
  clampToDisc,
  containAll,
  createSimulation,
  folderAnchors,
  fromOffset,
  type Offset,
  seedInCompartment,
  type SimLink,
  type SimNode,
  toOffset
} from './layout'
import { folderHues, matchesSearch, radiusOf, type VaultGraph } from './model'
import type { ClusterMode, LabelMode } from './prefs'
import {
  buildGeometry,
  compartmentOf,
  compartmentRadii,
  EMPTY_GEOMETRY,
  type Geometry,
  geometrySignature,
  type Region,
  regionAt,
  regionChain,
  regionOfDir
} from './regions'

type Viewport = View

/** Notes changed by something else stay highlighted this long. */
const TOUCHED_MS = 10 * 60 * 1000

/** A region is drawn (and can be hit) once its on-screen radius reaches this, and its label once it reaches the second. */
const REGION_MIN_PX = 14
const LABEL_MIN_PX = 40
/** The camera "is in" a region once the region's on-screen radius reaches this fraction of the viewport's short side. */
const CURRENT_FRACTION = 0.25
/** The global Fit action never magnifies past this; framing a folder is not capped. */
const FIT_CAP = 1.8

const hsl = (hue: number, lightness: number): string => `hsl(${hue} 62% ${lightness}%)`

export interface GraphViewProps {
  cluster: ClusterMode
  /** The whole vault's graph. Nested region geometry comes from it, so filters never repack the map. Defaults to `graph`. */
  fullGraph?: VaultGraph
  /** Folders hidden via the legend (still listed there so they can be turned back on). */
  hiddenFolders: ReadonlySet<string>
  graph: VaultGraph
  labels: LabelMode
  /** The unfiltered folder list, for the legend. */
  legendFolders: readonly string[]
  /** Compartment-relative positions of the nested layout. */
  nestedPositions?: Record<string, Offset>
  onNestedPositions?: (positions: Record<string, Offset>) => void
  onOpen: (rel: string) => void
  /** Optional probe: the duration of each canvas paint, in ms (for measurement; costs two clock reads when set). */
  onPaintTime?: (ms: number) => void
  onPositions: (mode: 'folder' | 'none', positions: Record<string, [number, number]>) => void
  onToggleFolder: (folder: string) => void
  onTogglePin: (rel: string) => void
  /** Notes open in the note pane — drawn with a ring. */
  openRels: ReadonlySet<string>
  pinned: ReadonlySet<string>
  positions: Record<string, [number, number]>
  /** The layout `positions` were saved under; absent for positions saved before it was recorded. */
  positionsMode?: 'folder' | 'none'
  search: string
  selected: null | string
  touched: Record<string, number>
}

interface LabelBox {
  box: [number, number, number, number]
  id: string
}

export function GraphView(props: GraphViewProps) {
  const { cluster, graph, hiddenFolders, labels, legendFolders, onOpen, onToggleFolder, selected } = props
  const nested = cluster === 'nested'
  const t = usePluginI18n(PLUGIN_ID)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<null | Simulation<SimNode, SimLink>>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const viewRef = useRef<Viewport>({ k: 1, x: 0, y: 0 })
  const sizeRef = useRef({ h: 0, w: 0 })
  const hoverRef = useRef<null | string>(null)
  const hoverRegionRef = useRef<null | string>(null)
  const cursorRef = useRef<null | string>(null)
  const frameRef = useRef(0)
  const animRef = useRef(0)
  const fittedRef = useRef(false)
  const refitRef = useRef(false)
  /** What the live nodes were laid out under, to tell a mode switch from a repack. */
  const layoutRef = useRef<null | { geometry: Geometry; mode: ClusterMode }>(null)
  /** Regions that hold a shown note: the rest are drawn faintly. */
  const occupiedRef = useRef<ReadonlySet<string>>(new Set())
  const labelBoxesRef = useRef<LabelBox[]>([])
  /** The camera is exactly where the last framing put it (so a viewport resize re-frames instead of drifting). */
  const anchoredRef = useRef(false)
  const [pointer, setPointer] = useState(false)
  /** The region the camera is in (null = the whole map) and the region under the pointer, for the path display. */
  const [current, setCurrentState] = useState<null | string>(null)
  const currentRef = useRef<null | string>(null)
  const [hoverRegion, setHoverRegion] = useState<null | string>(null)

  // The draw routine and event handlers read the freshest props through this ref.
  const live = useRef(props)

  live.current = props

  const folders = useMemo(() => [...new Set(graph.nodes.map(node => node.folder))].sort(), [graph])

  // Region geometry is static: a function of the whole vault's folder tree and footprint buckets, rebuilt only
  // when that identity changes — not on filters, toggles, search or most link edits.
  const geometryCache = useRef<Geometry>(EMPTY_GEOMETRY)
  const source = props.fullGraph ?? graph

  const geometry = useMemo(() => {
    if (!nested) {
      return EMPTY_GEOMETRY
    }

    const radii = compartmentRadii(source.nodes)

    if (geometryCache.current.signature !== geometrySignature(radii) || geometryCache.current === EMPTY_GEOMETRY) {
      geometryCache.current = buildGeometry(radii)
    }

    return geometryCache.current
  }, [nested, source])

  const geometryRef = useRef(geometry)

  geometryRef.current = geometry

  // Hues are spread evenly over the vault's whole folder list (not just what is shown), so a
  // folder keeps its colour while others are toggled off. With clustering off everything is one colour.
  const hues = useMemo(() => folderHues(legendFolders), [legendFolders])
  const huesRef = useRef(hues)

  huesRef.current = hues

  const colorOf = (folder: string): number => (cluster === 'none' ? 210 : (huesRef.current.get(folder) ?? 210))

  const limits = () => zoomLimits(nested ? geometryRef.current : null, sizeRef.current.w, sizeRef.current.h)

  const regionVisible = (region: Region): boolean => region.r * viewRef.current.k >= REGION_MIN_PX

  const setCurrent = (id: null | string) => {
    if (currentRef.current !== id) {
      currentRef.current = id
      setCurrentState(id)
    }
  }

  const setHoveredRegion = (id: null | string) => {
    if (hoverRegionRef.current !== id) {
      hoverRegionRef.current = id
      setHoverRegion(id)
    }
  }

  const paintRegions = (ctx: CanvasRenderingContext2D, ink: string, labelPlaced: [number, number, number, number][]) => {
    const geo = geometryRef.current
    const { h, w } = sizeRef.current
    const { k, x, y } = viewRef.current
    const root = geo.root === null ? undefined : geo.regions.get(geo.root)
    const left = -x / k
    const top = -y / k
    const right = (w - x) / k
    const bottom = (h - y) / k
    const focusId = hoverRegionRef.current
    const chain = new Set(focusId === null ? [] : regionChain(geo, focusId).map(region => region.id))
    const fontPx = 11 / k

    labelBoxesRef.current = []
    ctx.font = `600 ${fontPx}px "Segoe UI", system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const disc = (cx: number, cy: number, r: number, hue: number, depth: number, lit: boolean, empty: boolean, own: boolean) => {
      const recede = focusId !== null && !lit
      const faint = empty ? 0.35 : 1

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.globalAlpha = (own ? 0.05 : 0.16 / (1 + 0.45 * depth)) * (lit ? 1.7 : recede ? 0.45 : 1) * faint
      ctx.fillStyle = hsl(hue, Math.min(72, 50 + 4 * depth))
      ctx.fill()
      ctx.globalAlpha = (lit ? 0.85 : recede ? 0.12 : 0.32) * faint
      ctx.strokeStyle = hsl(hue, Math.min(72, 54 + 4 * depth))
      ctx.lineWidth = (lit ? 1.8 : 1) / k
      ctx.stroke()
    }

    // A region whose children are not drawn yet is a plain disc; labels need room to be legible.
    const visit = (region: Region) => {
      const s = region.r * k

      if (
        s < REGION_MIN_PX ||
        region.x + region.r < left ||
        region.x - region.r > right ||
        region.y + region.r < top ||
        region.y - region.r > bottom
      ) {
        return
      }

      const hue = colorOf(region.top)
      const lit = chain.has(region.id)
      const covers = [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom]
      ].every(([px, py]) => Math.hypot(px! - region.x, py! - region.y) < region.r)

      // Above the band (the region has outgrown the viewport) only the outline — which is off screen — remains.
      if (!covers) {
        disc(region.x, region.y, region.r, hue, region.depth, lit, !occupiedRef.current.has(region.id), false)
      }

      const comp = region.compartment

      if (comp && region.children.length && comp.r * k >= REGION_MIN_PX) {
        disc(comp.x, comp.y, comp.r, hue, region.depth + 1, lit, !occupiedRef.current.has(region.id), true)
      }

      const forced = region.id === focusId || region.id === currentRef.current

      if (region.label && !covers && (s >= LABEL_MIN_PX || forced)) {
        const width = ctx.measureText(region.label).width
        const half = width / 2 + 3 / k
        const room = region.r > half ? region.r - Math.sqrt(region.r * region.r - half * half) : region.r
        const dy = Math.max(3 / k, room)

        if (room < region.r || forced) {
          const box: [number, number, number, number] = [
            region.x - width / 2,
            region.y - region.r + dy,
            region.x + width / 2,
            region.y - region.r + dy + fontPx * 1.15
          ]

          if (forced || !labelPlaced.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
            labelPlaced.push(box)
            labelBoxesRef.current.push({ box: [box[0] - 2 / k, box[1] - 2 / k, box[2] + 2 / k, box[3] + 2 / k], id: region.id })
            ctx.globalAlpha = lit || forced ? 1 : focusId !== null ? 0.4 : 0.85
            ctx.fillStyle = ink
            ctx.fillText(region.label, region.x, box[1])
          }
        }
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
  }

  const paint = () => {
    const canvas = canvasRef.current

    if (!canvas || sizeRef.current.w === 0) {
      return
    }

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const started = live.current.onPaintTime ? performance.now() : 0
    const { openRels, pinned, search, selected: current, touched, labels: labelMode } = live.current
    const dpr = window.devicePixelRatio || 1
    const { h, w } = sizeRef.current
    const { k, x, y } = viewRef.current
    const style = getComputedStyle(canvas)
    const ink = style.getPropertyValue('--ui-text-secondary').trim() || '#888'
    const muted = style.getPropertyValue('--ui-stroke-secondary').trim() || '#8885'
    const accent = style.getPropertyValue('--ui-accent').trim() || '#4a9eff'
    const focus = hoverRef.current ?? cursorRef.current ?? current
    const near = new Set<string>()
    const searching = search.trim().length > 0
    const now = Date.now()

    if (focus) {
      near.add(focus)

      for (const link of linksRef.current) {
        const s = (link.source as SimNode).id
        const target = (link.target as SimNode).id

        if (s === focus) {
          near.add(target)
        } else if (target === focus) {
          near.add(s)
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.translate(x, y)
    ctx.scale(k, k)
    ctx.lineWidth = 1 / k

    // Region labels are placed before note labels, so notes yield to them.
    const placed: [number, number, number, number][] = []

    if (nested) {
      paintRegions(ctx, ink, placed)
    }

    for (const link of linksRef.current) {
      const s = link.source as SimNode
      const target = link.target as SimNode
      const lit = focus !== null && (s.id === focus || target.id === focus)

      ctx.globalAlpha = focus === null ? 0.35 : lit ? 0.9 : 0.08
      ctx.strokeStyle = lit ? accent : muted
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(target.x, target.y)
      ctx.stroke()
    }

    for (const node of nodesRef.current) {
      const dim = (focus !== null && !near.has(node.id)) || (searching && !matchesSearch(node, search))
      const r = radiusOf(node)

      ctx.globalAlpha = dim ? 0.16 : 1
      ctx.fillStyle = hsl(colorOf(node.folder), 58)
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fill()

      const recent = now - (touched[node.id] ?? 0) < TOUCHED_MS && touched[node.id] !== undefined

      if (recent) {
        ctx.globalAlpha = dim ? 0.3 : 0.9
        ctx.strokeStyle = accent
        ctx.setLineDash([2 / k, 2 / k])
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 6 / k, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (openRels.has(node.id) || node.id === current) {
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

    // Labels. A canvas font cannot use CSS variables, so name the families outright; the size is
    // divided by the zoom so the text stays ~11px on screen. Highest-priority labels are placed
    // first and any that would overlap an already placed one are skipped, so a dense graph stays legible.
    const fontPx = 11 / k

    ctx.fillStyle = ink
    ctx.font = `${fontPx}px "Segoe UI", system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const priority = (node: SimNode, matched: boolean): number =>
      node.id === focus ? 1e6 : near.has(node.id) ? 1e5 + node.degree : matched ? 1e4 + node.degree : node.degree

    const candidates = nodesRef.current
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
      .slice(0, 400)

    for (const { matched, node } of candidates) {
      const width = ctx.measureText(node.title).width
      const left = node.x - width / 2
      const top = node.y + radiusOf(node) + 2 / k
      const box: [number, number, number, number] = [left, top, left + width, top + fontPx * 1.15]

      if (node.id !== focus && placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
        continue
      }

      placed.push(box)
      ctx.globalAlpha = node.id === focus ? 1 : matched || near.has(node.id) ? 0.95 : 0.8
      ctx.fillText(node.title, node.x, top)
    }

    ctx.globalAlpha = 1
    live.current.onPaintTime?.(performance.now() - started)
  }

  // Handlers created by an earlier render (the simulation's, the observers') always paint with the latest closure.
  const paintRef = useRef(paint)

  paintRef.current = paint

  const draw = () => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => paintRef.current())
  }

  // ---- camera ---------------------------------------------------------------------------------

  /** Move the camera to `target`, over a smooth zoom path unless `instant`. Framing changes only the camera. */
  const moveTo = (target: View, instant: boolean) => {
    cancelAnimationFrame(animRef.current)

    const { h, w } = sizeRef.current

    if (instant || !viewRef.current.k || !w || !h) {
      viewRef.current = target
      draw()

      return
    }

    const path = zoomPath(viewRef.current, target, w, h)
    const began = performance.now()

    const run = () => {
      const progress = Math.min(1, (performance.now() - began) / path.ms)
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2

      viewRef.current = path.at(eased)
      paintRef.current()

      if (progress < 1) {
        animRef.current = requestAnimationFrame(run)
      }
    }

    animRef.current = requestAnimationFrame(run)
  }

  /** Frame a region (null = the whole map): centre it and fit its disc, within the shared zoom limits. */
  const frame = (id: null | string, instant = false) => {
    const geo = geometryRef.current
    const { h, w } = sizeRef.current
    const root = geo.root === null ? undefined : geo.regions.get(geo.root)
    const region = id === null || id === geo.root ? root : geo.regions.get(id)

    if (!region || !w || !h) {
      return
    }

    // Only the global Fit action is capped; framing a folder magnifies as far as the limits allow.
    const target = frameDisc(region, w, h, limits(), region === root ? FIT_CAP : Infinity)

    if (!target) {
      return
    }

    anchoredRef.current = true
    setCurrent(region === root ? null : region.id)
    moveTo(target, instant)
  }

  /** The region the camera is in, read from the camera itself (after a manual pan or zoom). */
  const syncCurrent = () => {
    const geo = geometryRef.current
    const { h, w } = sizeRef.current
    const { k, x, y } = viewRef.current
    const side = Math.min(w, h)
    const inside = regionAt(geo, (w / 2 - x) / k, (h / 2 - y) / k, region => region.r * k >= CURRENT_FRACTION * side)

    setCurrent(inside === null || inside.id === geo.root ? null : inside.id)
  }

  const fit = () => {
    if (nested) {
      frame(null)

      return
    }

    const { h, w } = sizeRef.current
    const nodes = nodesRef.current

    if (!nodes.length || !w || !h) {
      return
    }

    const xs = nodes.map(node => node.x)
    const ys = nodes.map(node => node.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = 48
    const k = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1), FIT_CAP)

    viewRef.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k }
    draw()
  }

  // (Re)build the simulation when the drawn graph, the clustering or the region geometry changes, keeping known positions.
  useEffect(() => {
    const previousLayout = layoutRef.current
    // Live positions are only meaningful under the layout they were produced by.
    const sameMode = previousLayout?.mode === cluster
    const previous = new Map(nodesRef.current.map(node => [node.id, node]))
    const saved = live.current.positions
    const savedNested = live.current.nestedPositions ?? {}
    const savedMode = live.current.positionsMode
    const absoluteSaved = !nested && (savedMode === undefined || savedMode === cluster)
    const pinnedNow = live.current.pinned
    const anchors = folderAnchors(folders, cluster)
    const perDir = new Map<string, number>()

    for (const node of graph.nodes) {
      perDir.set(node.dir, (perDir.get(node.dir) ?? 0) + 1)
    }

    const seen = new Map<string, number>()
    let restored = 0

    const nodes: SimNode[] = graph.nodes.map(node => {
      const index = seen.get(node.dir) ?? 0

      seen.set(node.dir, index + 1)

      const comp = nested ? compartmentOf(geometry, node.dir) : undefined
      const old = sameMode ? previous.get(node.id) : undefined
      let known: undefined | { x: number; y: number }

      if (nested) {
        // Compartment-relative: carried through a repack by offset, then contained below.
        const oldComp = old && previousLayout ? compartmentOf(previousLayout.geometry, old.dir) : undefined
        const stored = savedNested[node.id]

        if (comp && old && oldComp && old.dir === node.dir) {
          const [x, y] = fromOffset(comp, (old.x - oldComp.x) / oldComp.r, (old.y - oldComp.y) / oldComp.r)

          known = { x, y }
        } else if (comp && !old && stored && stored[0] === node.dir) {
          const [x, y] = fromOffset(comp, stored[1], stored[2])

          known = { x, y }
        }
      } else if (old) {
        known = old
      } else if (absoluteSaved && saved[node.id]) {
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

      if (pinnedNow.has(node.id)) {
        placed.fx = placed.x
        placed.fy = placed.y
      }

      return placed
    })

    // Whole-note containment before anything is painted: after seeding, restoring or remapping, and
    // after a compartment shrinks or a note's radius grows (a normalised offset alone does not survive those).
    if (nested) {
      containAll(nodes, geometry)
    }

    const known = new Set(nodes.map(node => node.id))

    const links: SimLink[] = graph.edges
      .filter(edge => known.has(edge.source) && known.has(edge.target))
      .map(edge => ({ source: edge.source, target: edge.target }))

    // A different set of notes (local graph, a folder toggled, a big import) deserves a fresh fit; so does
    // a remembered layout, whose view was never fitted this session. A note added or removed does not.
    // Nested mode keeps its camera through those: the map does not move, so neither should the view.
    const changed = nodes.filter(node => !previous.has(node.id)).length + [...previous.keys()].filter(id => !known.has(id)).length
    const bigChange = previous.size > 0 && changed >= Math.max(3, 0.25 * Math.max(previous.size, nodes.length))

    nodesRef.current = nodes
    linksRef.current = links
    simRef.current?.stop()

    const occupied = new Set<string>()

    if (nested) {
      for (const node of nodes) {
        for (let region = regionOfDir(geometry, node.dir); region && !occupied.has(region.id); ) {
          occupied.add(region.id)
          region = region.parent === null ? null : (geometry.regions.get(region.parent) ?? null)
        }
      }
    }

    occupiedRef.current = occupied

    // A mostly-restored layout only needs a gentle settle, not a full re-explosion.
    const warm = nodes.length > 0 && restored / nodes.length > 0.8

    const sim = createSimulation(nodes, links, { cluster, folders, geometry }, warm ? 0.08 : 1)
      .on('tick', () => {
        // d3 dispatches `tick` after the step; contain the notes before they are drawn.
        if (nested) {
          containAll(nodes, geometry)
        }

        draw()
      })
      .on('end', () => {
        if (!nested && (!fittedRef.current || refitRef.current)) {
          fittedRef.current = true
          refitRef.current = false
          fit()
        }

        if (nested) {
          live.current.onNestedPositions?.(
            Object.fromEntries(
              nodesRef.current.flatMap(node => {
                const comp = compartmentOf(geometry, node.dir)

                if (!comp) {
                  return []
                }

                const [dir, u, v] = toOffset(node, comp)

                return [[node.id, [dir, Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4] as Offset]]
              })
            )
          )
        } else {
          live.current.onPositions(
            cluster as 'folder' | 'none',
            Object.fromEntries(nodesRef.current.map(node => [node.id, [Math.round(node.x), Math.round(node.y)]]))
          )
        }
      })

    simRef.current = sim

    if (!sameMode) {
      // A different layout: whatever the view framed is meaningless now.
      fittedRef.current = false
      setCurrent(null)
    }

    layoutRef.current = { geometry, mode: cluster }

    if (nested) {
      // The map is static, so it can be framed before the notes settle.
      if (!fittedRef.current && sizeRef.current.w > 0) {
        fittedRef.current = true
        frame(null, true)
      }
    } else {
      refitRef.current = warm || bigChange || (!sameMode && previous.size > 0)

      if ((warm || bigChange) && sizeRef.current.w > 0) {
        fittedRef.current = true
        fit()
      }
    }

    draw()

    return () => void sim.stop()
    // `draw`/`fit`/`frame` read refs only; the simulation is rebuilt when the drawn graph, clustering or geometry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, folders, cluster, geometry])

  // Track the container's size; redraw on resize.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current

    if (!wrap || !canvas) {
      return
    }

    const observer = new ResizeObserver(() => {
      const { height, width } = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      sizeRef.current = { h: height, w: width }
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))

      if (!fittedRef.current && width > 0 && nodesRef.current.length) {
        fittedRef.current = true
        fit()
      } else if (nested && width > 0 && height > 0) {
        // The zoom limits depend on the viewport: stay framed on the same region, else keep within the new limits.
        if (anchoredRef.current) {
          frame(currentRef.current, true)
        } else {
          viewRef.current = { ...viewRef.current, k: clampScale(viewRef.current.k, limits()) }
          draw()
        }
      } else {
        draw()
      }
    })

    observer.observe(wrap)

    // The computed theme tokens settle a frame after the app flips its theme attributes.
    const themeObserver = new MutationObserver(() => requestAnimationFrame(draw))

    themeObserver.observe(document.documentElement, {
      attributeFilter: ['class', 'style', 'data-hermes-mode', 'data-hermes-theme'],
      attributes: true
    })

    return () => {
      observer.disconnect()
      themeObserver.disconnect()
      cancelAnimationFrame(frameRef.current)
      cancelAnimationFrame(animRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nested])

  // Pinned nodes are held in place; unpinned ones are released. A pin target is always revalidated.
  useEffect(() => {
    for (const node of nodesRef.current) {
      node.fx = props.pinned.has(node.id) ? node.x : null
      node.fy = props.pinned.has(node.id) ? node.y : null
    }

    if (nested) {
      containAll(nodesRef.current, geometryRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pinned])

  // Repaint when anything the draw routine reads changes.
  useEffect(() => {
    const id = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, props.openRels, props.search, props.pinned, props.touched, labels, hiddenFolders])

  const worldAt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { k, x, y } = viewRef.current

    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k }
  }

  const hit = (clientX: number, clientY: number): null | SimNode => {
    const at = worldAt(clientX, clientY)
    const slack = 3 / viewRef.current.k
    let best: null | SimNode = null
    let bestDist = Infinity

    for (const node of nodesRef.current) {
      const d = Math.hypot(node.x - at.x, node.y - at.y)

      if (d <= radiusOf(node) + slack && d < bestDist) {
        best = node
        bestDist = d
      }
    }

    return best
  }

  /** Pointer priority after notes: a region's label, then the region's area. */
  const labelAt = (clientX: number, clientY: number): null | string => {
    const at = worldAt(clientX, clientY)

    return (
      labelBoxesRef.current.find(({ box }) => at.x >= box[0] && at.x <= box[2] && at.y >= box[1] && at.y <= box[3])?.id ?? null
    )
  }

  const regionUnder = (clientX: number, clientY: number): null | Region => {
    const at = worldAt(clientX, clientY)

    return regionAt(geometryRef.current, at.x, at.y, regionVisible)
  }

  const drag = useRef<null | {
    label: null | string
    moved: boolean
    node: null | SimNode
    startX: number
    startY: number
    view: Viewport
  }>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()

    const node = hit(event.clientX, event.clientY)
    const label = nested && !node ? labelAt(event.clientX, event.clientY) : null

    drag.current = {
      label,
      moved: false,
      node,
      startX: event.clientX,
      startY: event.clientY,
      view: { ...viewRef.current }
    }

    if (node) {
      node.fx = node.x
      node.fy = node.y
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current

    if (!d) {
      const over = hit(event.clientX, event.clientY)
      const region = nested ? (over ? regionOfDir(geometryRef.current, over.dir) : regionUnder(event.clientX, event.clientY)) : null
      const label = nested && !over ? labelAt(event.clientX, event.clientY) : null
      const overId = over?.id ?? null
      const regionId = label ?? region?.id ?? null
      const changed = overId !== hoverRef.current || regionId !== hoverRegionRef.current

      hoverRef.current = overId
      setHoveredRegion(regionId)
      setPointer(over !== null || label !== null)

      if (changed) {
        draw()
      }

      return
    }

    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true
    }

    if (d.node && d.moved) {
      const at = worldAt(event.clientX, event.clientY)
      const comp = nested ? compartmentOf(geometryRef.current, d.node.dir) : undefined

      // A note cannot leave its compartment, so the pointer target is clamped before d3 reapplies it.
      const [fx, fy] = comp ? clampToDisc(comp, radiusOf(d.node), at.x, at.y) : [at.x, at.y]

      d.node.fx = fx
      d.node.fy = fy
      simRef.current?.alphaTarget(0.25).restart()
    } else if (!d.node && d.moved) {
      cancelAnimationFrame(animRef.current)
      anchoredRef.current = false
      viewRef.current = { ...d.view, x: d.view.x + dx, y: d.view.y + dy }

      if (nested) {
        syncCurrent()
      }

      draw()
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current

    drag.current = null

    if (d && !d.node && !d.moved && d.label !== null) {
      frame(d.label)

      return
    }

    if (!d?.node) {
      return
    }

    if (!d.moved && event.shiftKey) {
      // Pinning is applied to the node by the `pinned` effect once the store updates.
      live.current.onTogglePin(d.node.id)
    } else if (!live.current.pinned.has(d.node.id)) {
      // A dragged node stays where it was dropped only if it is pinned; otherwise release it.
      d.node.fx = null
      d.node.fy = null
    }

    simRef.current?.alphaTarget(0)

    if (!d.moved && !event.shiftKey) {
      onOpen(d.node.id)
    }
  }

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const { k, x, y } = viewRef.current
    const next = clampScale(k * Math.exp(-event.deltaY * 0.0015), limits())
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top

    cancelAnimationFrame(animRef.current)
    anchoredRef.current = false
    viewRef.current = { k: next, x: px - ((px - x) / k) * next, y: py - ((py - y) / k) * next }

    if (nested) {
      syncCurrent()
    }

    draw()
  }

  // Keyboard: arrows hop to the linked note nearest that direction, Enter opens, P pins, Escape goes up a folder.
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'Escape') {
      const region = currentRef.current === null ? undefined : geometryRef.current.regions.get(currentRef.current)

      if (nested && region) {
        event.preventDefault()
        frame(region.parent)
      }

      return
    }

    const nodes = nodesRef.current
    const byId = new Map(nodes.map(node => [node.id, node]))
    const current = byId.get(cursorRef.current ?? selected ?? '') ?? [...nodes].sort((a, b) => b.degree - a.degree)[0]

    if (!current) {
      return
    }

    const dir: Record<string, [number, number]> = {
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1]
    }

    if (event.key === 'Enter') {
      onOpen(current.id)
    } else if (event.key.toLowerCase() === 'p') {
      live.current.onTogglePin(current.id)
    } else if (dir[event.key]) {
      const [dx, dy] = dir[event.key]!
      const linked = new Set<string>()

      for (const link of linksRef.current) {
        const s = (link.source as SimNode).id
        const target = (link.target as SimNode).id

        if (s === current.id) {
          linked.add(target)
        } else if (target === current.id) {
          linked.add(s)
        }
      }

      const pool = (linked.size ? [...linked] : nodes.map(node => node.id)).map(id => byId.get(id)!).filter(Boolean)

      const best = pool
        .filter(node => node.id !== current.id)
        .map(node => {
          const vx = node.x - current.x
          const vy = node.y - current.y
          const len = Math.hypot(vx, vy) || 1

          return { alignment: (vx * dx + vy * dy) / len, dist: len, node }
        })
        .filter(item => item.alignment > 0.3)
        .sort((a, b) => b.alignment / (1 + b.dist / 200) - a.alignment / (1 + a.dist / 200))[0]

      if (best) {
        cursorRef.current = best.node.id
      }
    } else {
      return
    }

    event.preventDefault()
    draw()
  }

  // The path shown: the region under the pointer, else the one the camera is in. The whole map is the first step.
  const crumbs = nested
    ? [
        { id: null as null | string, label: t('graph.pathRoot') },
        ...regionChain(geometry, hoverRegion ?? current)
          .filter(region => region.id !== geometry.root)
          .map(region => ({ id: region.id as null | string, label: region.label }))
      ]
    : []

  return (
    <div className="vc-graph" ref={wrapRef}>
      <canvas
        aria-label={nested ? `${t('graph.graphLabel')} ${t('graph.nestedHelp')}` : t('graph.graphLabel')}
        className="vc-canvas"
        onBlur={() => {
          cursorRef.current = null
          draw()
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerLeave={() => {
          hoverRef.current = null
          setHoveredRegion(null)
          setPointer(false)
          draw()
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        ref={canvasRef}
        style={{ cursor: pointer ? 'pointer' : 'grab' }}
        tabIndex={0}
        title={nested ? t('graph.nestedHelp') : undefined}
      />
      <div className="vc-legend">
        {legendFolders.map(folder => (
          <button
            aria-pressed={!hiddenFolders.has(folder)}
            data-off={hiddenFolders.has(folder)}
            key={folder || '(root)'}
            onClick={() => onToggleFolder(folder)}
            type="button"
          >
            <span className="vc-dot" style={{ background: hsl(colorOf(folder), 58) }} />
            {folder || '(root)'}
          </button>
        ))}
      </div>
      {nested && geometry.root !== null && (
        <nav aria-label={t('graph.pathLabel')} className="vc-crumbs">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id ?? ''}>
              {index > 0 && <span aria-hidden>/</span>}
              <button onClick={() => frame(crumb.id)} type="button">
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </nav>
      )}
      <div className="vc-footer">
        <button onClick={fit} title={t('graph.fit')} type="button">
          <span className="vc-icon">
            <Codicon name="screen-full" size="0.8rem" /> {t('graph.fit')}
          </span>
        </button>
        <span>{t('graph.stats', graph.nodes.length, graph.edges.length)}</span>
      </div>
    </div>
  )
}
