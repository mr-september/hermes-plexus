import type { Simulation } from 'd3-force'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon, usePluginI18n } from '@hermes/plugin-sdk'

import { clampScale, frameDisc, type View, zoomLimits, zoomPath } from './camera'
import { type DrawnEdge, drawnEdges } from './edges'
import { adjacencyOf, hopTarget, nestedOffsets, occupiedRegions, seedNodes } from './graph-nodes'
import { type Box, hsl, type LabelBox, paintEdges, paintNodes, paintNoteLabels, paintRegions, REGION_MIN_PX, type Scene } from './graph-paint'
import { HiddenControls } from './hidden-controls'
import { coveringEntry, subtreeCount } from './hidden'
import { PLUGIN_ID } from './i18n'
import { clampToDisc, containAll, createSimulation, folderAnchors, type Offset, type SimLink, type SimNode } from './layout'
import { folderHues, radiusOf, type VaultGraph } from './model'
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

/** The camera "is in" a region once the region's on-screen radius reaches this fraction of the viewport's short side. */
const CURRENT_FRACTION = 0.25
/** The global Fit action never magnifies past this; framing a folder is not capped. */
const FIT_CAP = 1.8

export interface GraphViewProps {
  cluster: ClusterMode
  /** The whole vault's graph. Nested region geometry comes from it, so filters never repack the map. Defaults to `graph`. */
  fullGraph?: VaultGraph
  /** Draw edges at all (default true). Off suppresses every edge, a focused note's included. */
  edges?: boolean
  /** Folder paths hidden from the graph; each covers its subtree. Every entry has a control that removes it. */
  hiddenFolders: ReadonlySet<string>
  graph: VaultGraph
  labels: LabelMode
  /** The unfiltered folder list, for the legend. */
  legendFolders: readonly string[]
  /** Compartment-relative positions of the nested layout. */
  nestedPositions?: Record<string, Offset>
  /** Remove every hidden entry. */
  onClearHidden: () => void
  /** Hide a folder's subtree; says what already covered it, if anything. */
  onHidePath: (path: string) => { coveredBy: null | string }
  onNestedPositions?: (positions: Record<string, Offset>) => void
  onOpen: (rel: string) => void
  /** Optional probe: the duration of each canvas paint, in ms (for measurement; costs two clock reads when set). */
  onPaintTime?: (ms: number) => void
  /** Remove exactly one hidden entry. */
  onShowPath: (path: string) => void
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
  /** Style edges by class (default true). Off draws every edge alike, as the local graph does. */
  tierEdges?: boolean
  touched: Record<string, number>
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
  const adjacencyRef = useRef<Map<string, string[]>>(new Map())
  const edgesRef = useRef<DrawnEdge<SimNode>[]>([])
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 })
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

  const legendCounts = useMemo(() => {
    const counts = new Map<string, number>()

    for (const node of source.nodes) {
      counts.set(node.folder, (counts.get(node.folder) ?? 0) + 1)
    }

    return counts
  }, [source])

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
    const { edges, hiddenFolders: hidden, labels: labelMode, openRels, pinned, search, selected: current, tierEdges, touched } = live.current
    const dpr = window.devicePixelRatio || 1
    const { h, w } = sizeRef.current
    const { k, x, y } = viewRef.current
    const style = getComputedStyle(canvas)
    const focus = hoverRef.current ?? cursorRef.current ?? current

    const scene: Scene = {
      accent: style.getPropertyValue('--ui-accent').trim() || '#4a9eff',
      canvas,
      currentRegion: currentRef.current,
      edges: edgesRef.current,
      edgesOn: edges !== false,
      focus,
      geometry: geometryRef.current,
      hiddenFolders: hidden,
      hiddenSuffix: t('graph.hiddenSuffix'),
      hoverRegion: hoverRegionRef.current,
      hueOf: colorOf,
      ink: style.getPropertyValue('--ui-text-secondary').trim() || '#888',
      labelMode,
      muted: style.getPropertyValue('--ui-stroke-secondary').trim() || '#8885',
      near: new Set(focus ? [focus, ...(adjacencyRef.current.get(focus) ?? [])] : []),
      nested,
      nodes: nodesRef.current,
      occupied: occupiedRef.current,
      openRels,
      pinned,
      search,
      selected: current,
      size: sizeRef.current,
      tierEdges: tierEdges !== false,
      touched,
      view: viewRef.current
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.translate(x, y)
    ctx.scale(k, k)
    ctx.lineWidth = 1 / k

    // Region labels are placed before note labels, so notes yield to them.
    const placed: Box[] = []

    labelBoxesRef.current = nested ? paintRegions(ctx, scene, placed) : []

    if (scene.edgesOn) {
      paintEdges(ctx, scene)
    }

    paintNodes(ctx, scene)
    paintNoteLabels(ctx, scene, placed)

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

    if (instant || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !viewRef.current.k || !w || !h) {
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

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      maxX = Math.max(maxX, node.x)
      minY = Math.min(minY, node.y)
      maxY = Math.max(maxY, node.y)
    }

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
    const savedMode = live.current.positionsMode

    const { nodes, restored } = seedNodes({
      anchors: folderAnchors(folders, cluster),
      cluster,
      geometry,
      graph,
      nestedPositions: live.current.nestedPositions ?? {},
      pinned: live.current.pinned,
      previous: sameMode ? previous : new Map(),
      previousGeometry: previousLayout?.geometry,
      saved: !nested && (savedMode === undefined || savedMode === cluster) ? live.current.positions : undefined
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
    adjacencyRef.current = adjacencyOf(links)
    edgesRef.current = drawnEdges(new Map(nodes.map(node => [node.id, node])), graph.edges)
    occupiedRef.current = nested ? occupiedRegions(nodes, geometry) : new Set()
    simRef.current?.stop()

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
          live.current.onNestedPositions?.(nestedOffsets(nodesRef.current, geometry))
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
    view: View
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

  // Hide or show the camera's folder (never the hovered one: the pointer leaves the canvas to reach the button).
  // The target is the folder's own entry, else the deepest ancestor entry covering it, else the folder itself.
  const currentRegion = nested && current !== null ? geometry.regions.get(current) : undefined
  const covering = currentRegion ? coveringEntry(hiddenFolders, currentRegion.id) : null

  const action: null | { kind: 'hide' | 'show'; path: string } = currentRegion
    ? covering === null
      ? { kind: 'hide', path: currentRegion.id }
      : { kind: 'show', path: covering }
    : null

  const [announcement, setAnnouncement] = useState({ n: 0, text: '' })

  const announce = (text: string) => setAnnouncement(previous => ({ n: previous.n + 1, text }))

  const actOnCurrent = () => {
    if (!action || !currentRegion) {
      return
    }

    if (action.kind === 'hide') {
      const { coveredBy } = props.onHidePath(action.path)

      announce(
        coveredBy === null
          ? t('graph.announceHid', action.path, subtreeCount(source.nodes, action.path))
          : t('graph.announceCovered', action.path, coveredBy)
      )

      return
    }

    const rest = new Set(hiddenFolders)

    rest.delete(action.path)
    props.onShowPath(action.path)

    const still = coveringEntry(rest, currentRegion.id)

    announce(still === null ? t('graph.announceShown', action.path) : t('graph.announceStill', action.path, still))
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

    if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (nested) {
        event.preventDefault()

        if (!event.repeat) {
          actOnCurrent()
        }
      }

      return
    }

    const nodes = nodesRef.current
    const current = nodes.find(node => node.id === (cursorRef.current ?? selected ?? '')) ?? [...nodes].sort((a, b) => b.degree - a.degree)[0]

    if (!current) {
      return
    }

    if (event.key === 'Enter') {
      onOpen(current.id)
    } else if (event.key.toLowerCase() === 'p') {
      live.current.onTogglePin(current.id)
    } else if (event.key.startsWith('Arrow')) {
      const next = hopTarget(event.key, current, nodes, adjacencyRef.current)

      if (next) {
        cursorRef.current = next.id
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
            title={t('graph.subtree', legendCounts.get(folder) ?? 0)}
            type="button"
          >
            <span className="vc-dot" style={{ background: hsl(colorOf(folder), 58) }} />
            {folder || t('graph.rootNotes')}
          </button>
        ))}
        <HiddenControls
          entries={[...hiddenFolders]}
          legendFolders={legendFolders}
          nodes={source.nodes}
          onClear={props.onClearHidden}
          onShow={props.onShowPath}
        />
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
          {action && (
            <span className="vc-hide-wrap">
              <button onClick={actOnCurrent} type="button">
                {action.kind === 'hide'
                  ? t('graph.hideFolder', action.path, subtreeCount(source.nodes, action.path))
                  : t('graph.showFolder', action.path)}
              </button>
            </span>
          )}
        </nav>
      )}
      <div aria-live="polite" className="vc-sr" key={announcement.n} role="status">
        {announcement.text}
      </div>
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
