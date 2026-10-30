// Paint-cost probe: renders the real GraphView on a synthetic vault in a browser and reports the duration of
// each canvas paint (GraphView's `onPaintTime`), during the settle and while zooming the settled map.
// Driven by scripts/bench.mjs; parameters come from the URL hash.
import './seed'

import { createRoot } from 'react-dom/client'

import { GraphView } from '../../src/graph-view'
import type { ClusterMode } from '../../src/prefs'
import { installStyles } from '../../src/styles'
import { syntheticGraph } from '../synthetic'

const params = new URLSearchParams(location.hash.slice(1))
const num = (key: string, fallback: number) => Number(params.get(key) ?? fallback)
const cluster = (params.get('cluster') ?? 'nested') as ClusterMode

const graph = syntheticGraph({
  branching: num('branching', 3),
  crossFraction: num('cross', 0.1),
  depth: num('depth', 3),
  folderPerNote: params.get('per') === '1',
  links: num('links', 2),
  notes: num('n', 1000),
  seed: 4,
  skew: num('skew', 0.7)
})

const legend = [...new Set(graph.nodes.map(node => node.folder))].sort()
const during: number[] = []
const after: number[] = []
let frames = 0
let settled = false

const count = () => requestAnimationFrame(() => (frames++, count()))

count()
let sink = during

installStyles()

const root = document.getElementById('root')!

root.style.cssText = 'width:1400px;height:880px;position:relative'

createRoot(root).render(
  <GraphView
    cluster={cluster}
    graph={graph}
    hiddenFolders={new Set()}
    labels="auto"
    legendFolders={legend}
    onNestedPositions={() => (settled = true)}
    onOpen={() => undefined}
    onPaintTime={ms => sink.push(ms)}
    onPositions={() => (settled = true)}
    onToggleFolder={() => undefined}
    onTogglePin={() => undefined}
    openRels={new Set()}
    pinned={new Set()}
    positions={{}}
    search=""
    selected={null}
    touched={{}}
  />
)

const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)

  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 }
}

async function run() {
  const started = performance.now()

  while (!settled && performance.now() - started < 60_000) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const settleMs = performance.now() - started

  sink = after

  const canvas = document.querySelector('canvas')!

  for (let i = 0; i < 80; i++) {
    canvas.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, clientX: 700, clientY: 440, deltaY: i < 40 ? -120 : 120 })
    )
    await frame()
  }

  ;(window as unknown as { __result: unknown }).__result = {
    cluster,
    frames,
    during: stats(during),
    notes: graph.nodes.length,
    settleMs,
    settled,
    zooming: stats(after)
  }
  document.title = 'done'
}

void run()
