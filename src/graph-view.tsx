import {
  forceCenter,
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
import { useEffect, useMemo, useRef, useState } from 'react'

import { Codicon, usePluginI18n } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from './i18n'
import { folderHue, type GraphNode, matchesSearch, type VaultGraph } from './model'
import type { ClusterMode, LabelMode } from './prefs'

interface SimNode extends GraphNode, SimulationNodeDatum {
  x: number
  y: number
}

type SimLink = SimulationLinkDatum<SimNode>

interface Viewport {
  k: number
  x: number
  y: number
}

/** Notes changed by something else stay highlighted this long. */
const TOUCHED_MS = 10 * 60 * 1000

const radiusOf = (node: GraphNode): number => 3 + Math.sqrt(node.degree) * 1.7

const hsl = (folder: string, lightness: number): string => `hsl(${folderHue(folder)} 62% ${lightness}%)`

/** One anchor per folder, spread on a ring, so folders pull into clusters. */
function folderAnchors(folders: readonly string[], mode: ClusterMode): Map<string, { x: number; y: number }> {
  const ring = mode === 'none' ? 0 : 90 + folders.length * 22

  return new Map(
    folders.map((folder, index) => {
      const angle = (index / Math.max(folders.length, 1)) * Math.PI * 2

      return [folder, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }]
    })
  )
}

export interface GraphViewProps {
  cluster: ClusterMode
  /** Folders hidden via the legend (still listed there so they can be turned back on). */
  hiddenFolders: ReadonlySet<string>
  graph: VaultGraph
  labels: LabelMode
  /** The unfiltered folder list, for the legend. */
  legendFolders: readonly string[]
  onOpen: (rel: string) => void
  onPositions: (positions: Record<string, [number, number]>) => void
  onToggleFolder: (folder: string) => void
  onTogglePin: (rel: string) => void
  /** Notes open in the note pane — drawn with a ring. */
  openRels: ReadonlySet<string>
  pinned: ReadonlySet<string>
  positions: Record<string, [number, number]>
  search: string
  selected: null | string
  touched: Record<string, number>
}

export function GraphView(props: GraphViewProps) {
  const { cluster, graph, hiddenFolders, labels, legendFolders, onOpen, onToggleFolder, selected } = props
  const t = usePluginI18n(PLUGIN_ID)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<null | Simulation<SimNode, SimLink>>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const viewRef = useRef<Viewport>({ k: 1, x: 0, y: 0 })
  const sizeRef = useRef({ h: 0, w: 0 })
  const hoverRef = useRef<null | string>(null)
  const cursorRef = useRef<null | string>(null)
  const frameRef = useRef(0)
  const fittedRef = useRef(false)
  const [pointer, setPointer] = useState(false)

  // The draw routine and event handlers read the freshest props through this ref.
  const live = useRef(props)

  live.current = props

  const folders = useMemo(() => [...new Set(graph.nodes.map(node => node.folder))].sort(), [graph])

  const paint = () => {
    const canvas = canvasRef.current

    if (!canvas || sizeRef.current.w === 0) {
      return
    }

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

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
      ctx.fillStyle = cluster === 'none' ? hsl('', 58) : hsl(node.folder, 58)
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

    ctx.fillStyle = ink
    ctx.font = `${11 / k}px var(--font-sans, system-ui, sans-serif)`
    ctx.textAlign = 'center'

    for (const node of nodesRef.current) {
      const matched = searching && matchesSearch(node, search)

      const wanted =
        labelMode === 'never'
          ? node.id === focus
          : labelMode === 'always' || node.id === focus || near.has(node.id) || matched || node.degree >= 8 || k > 1.6

      if (!wanted || (focus !== null && !near.has(node.id) && !matched)) {
        continue
      }

      ctx.globalAlpha = node.id === focus ? 1 : 0.8
      ctx.fillText(node.title, node.x, node.y + radiusOf(node) + 11 / k)
    }

    ctx.globalAlpha = 1
  }

  const draw = () => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(paint)
  }

  const fit = () => {
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
    const pad = 56
    const k = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1), 2.5)

    viewRef.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k }
    draw()
  }

  // (Re)build the simulation when the drawn graph changes, keeping known positions.
  useEffect(() => {
    const previous = new Map(nodesRef.current.map(node => [node.id, node]))
    const saved = live.current.positions
    const pinnedNow = live.current.pinned
    const anchors = folderAnchors(folders, cluster)
    let restored = 0

    const nodes: SimNode[] = graph.nodes.map(node => {
      const old = previous.get(node.id)
      const known = old ?? (saved[node.id] ? { x: saved[node.id]![0], y: saved[node.id]![1] } : undefined)
      const anchor = anchors.get(node.folder) ?? { x: 0, y: 0 }

      if (known) {
        restored++
      }

      const placed: SimNode = {
        ...node,
        x: known?.x ?? anchor.x + (Math.random() - 0.5) * 40,
        y: known?.y ?? anchor.y + (Math.random() - 0.5) * 40
      }

      if (pinnedNow.has(node.id)) {
        placed.fx = placed.x
        placed.fy = placed.y
      }

      return placed
    })

    const known = new Set(nodes.map(node => node.id))

    const links: SimLink[] = graph.edges
      .filter(edge => known.has(edge.source) && known.has(edge.target))
      .map(edge => ({ source: edge.source, target: edge.target }))

    nodesRef.current = nodes
    linksRef.current = links
    simRef.current?.stop()

    // A mostly-restored layout only needs a gentle settle, not a full re-explosion.
    const warm = nodes.length > 0 && restored / nodes.length > 0.8

    const sim = forceSimulation<SimNode>(nodes)
      .alpha(warm ? 0.08 : 1)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id(node => node.id)
          .distance(34)
          .strength(0.35)
      )
      .force('charge', forceManyBody<SimNode>().strength(-55).distanceMax(260))
      .force('center', forceCenter(0, 0).strength(0.02))
      .force('collide', forceCollide<SimNode>().radius(node => radiusOf(node) + 2))
      .force('x', forceX<SimNode>(node => anchors.get(node.folder)?.x ?? 0).strength(cluster === 'none' ? 0.02 : 0.07))
      .force('y', forceY<SimNode>(node => anchors.get(node.folder)?.y ?? 0).strength(cluster === 'none' ? 0.02 : 0.07))
      .on('tick', draw)
      .on('end', () => {
        if (!fittedRef.current) {
          fittedRef.current = true
          fit()
        }

        live.current.onPositions(
          Object.fromEntries(nodesRef.current.map(node => [node.id, [Math.round(node.x), Math.round(node.y)]]))
        )
      })

    simRef.current = sim

    if (warm && !fittedRef.current && sizeRef.current.w > 0) {
      fittedRef.current = true
      fit()
    }

    return () => void sim.stop()
    // `draw`/`fit` read refs only; the simulation is rebuilt when the drawn graph or clustering changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, folders, cluster])

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
        fit()
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pinned nodes are held in place; unpinned ones are released.
  useEffect(() => {
    for (const node of nodesRef.current) {
      node.fx = props.pinned.has(node.id) ? node.x : null
      node.fy = props.pinned.has(node.id) ? node.y : null
    }
  }, [props.pinned])

  // Repaint when anything the draw routine reads changes.
  useEffect(() => {
    const id = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, props.openRels, props.search, props.pinned, props.touched, labels])

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

  const drag = useRef<null | { moved: boolean; node: null | SimNode; startX: number; startY: number; view: Viewport }>(
    null
  )

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()

    const node = hit(event.clientX, event.clientY)

    drag.current = { moved: false, node, startX: event.clientX, startY: event.clientY, view: { ...viewRef.current } }

    if (node) {
      node.fx = node.x
      node.fy = node.y
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current

    if (!d) {
      const over = hit(event.clientX, event.clientY)?.id ?? null

      if (over !== hoverRef.current) {
        hoverRef.current = over
        setPointer(over !== null)
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

      d.node.fx = at.x
      d.node.fy = at.y
      simRef.current?.alphaTarget(0.25).restart()
    } else if (!d.node) {
      viewRef.current = { ...d.view, x: d.view.x + dx, y: d.view.y + dy }
      draw()
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current

    drag.current = null

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
    const next = Math.min(6, Math.max(0.1, k * Math.exp(-event.deltaY * 0.0015)))
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top

    viewRef.current = { k: next, x: px - ((px - x) / k) * next, y: py - ((py - y) / k) * next }
    draw()
  }

  // Keyboard: arrows hop to the linked note nearest that direction, Enter opens, P pins.
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
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

  return (
    <div className="vc-graph" ref={wrapRef}>
      <canvas
        aria-label={t('graph.graphLabel')}
        className="vc-canvas"
        onBlur={() => {
          cursorRef.current = null
          draw()
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerLeave={() => {
          hoverRef.current = null
          setPointer(false)
          draw()
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        ref={canvasRef}
        style={{ cursor: pointer ? 'pointer' : 'grab' }}
        tabIndex={0}
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
            <span className="vc-dot" style={{ background: cluster === 'none' ? hsl('', 58) : hsl(folder, 58) }} />
            {folder || '(root)'}
          </button>
        ))}
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
