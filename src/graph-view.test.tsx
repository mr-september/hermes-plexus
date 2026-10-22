import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GraphView, type GraphViewProps } from './graph-view'
import { buildGraph, indexNote } from './model'

type Call = [string, unknown[]]

let calls: Call[] = []

beforeEach(() => {
  calls = []
  vi.useFakeTimers()

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      disconnect() {}
      observe() {
        this.callback()
      }
      unobserve() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 800,
    toJSON: () => ({}),
    top: 0,
    width: 800,
    x: 0,
    y: 0
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy(
      {},
      {
        get: (_target, name: string) =>
          name === 'measureText' ? () => ({ width: 40 }) : (...args: unknown[]) => void calls.push([name, args]),
        set: () => true
      }
    ) as unknown as CanvasRenderingContext2D
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const full = buildGraph([
  indexNote('A/a1.md', '[[a2]] [[b1]]'),
  indexNote('A/a2.md', '[[a3]]'),
  indexNote('A/a3.md', '[[a1]]'),
  indexNote('B/b1.md', '[[b2]] [[a1]]'),
  indexNote('B/b2.md', '[[b3]]'),
  indexNote('B/b3.md', '[[b1]]')
])

const props = (graph = full, over: Partial<GraphViewProps> = {}): GraphViewProps => ({
  cluster: 'folder',
  graph,
  hiddenFolders: new Set(),
  labels: 'auto',
  legendFolders: ['A', 'B'],
  onOpen: () => undefined,
  onPositions: () => undefined,
  onToggleFolder: () => undefined,
  onTogglePin: () => undefined,
  openRels: new Set(),
  pinned: new Set(),
  positions: {},
  search: '',
  selected: null,
  touched: {},
  ...over
})

/** Screen-space centres of the node discs (arcs that are filled) in the most recent paint. */
function lastNodeCentres(): [number, number][] {
  const names = calls.map(call => call[0])
  const start = names.lastIndexOf('setTransform')
  const [tx, ty] = calls[names.indexOf('translate', start)]![1] as number[]
  const [k] = calls[names.indexOf('scale', start)]![1] as number[]
  const out: [number, number][] = []

  for (let i = start; i < calls.length - 1; i++) {
    if (names[i] === 'arc' && names[i + 1] === 'fill') {
      const [x, y] = calls[i]![1] as number[]

      out.push([x! * k! + tx!, y! * k! + ty!])
    }
  }

  return out
}

/** The bounding box of the drawn nodes should be centred in the 800×600 canvas, i.e. the view was refit. */
function expectCentred(centres: [number, number][]) {
  const xs = centres.map(([x]) => x)
  const ys = centres.map(([, y]) => y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  expect(Math.abs(cx - 400)).toBeLessThan(40)
  expect(Math.abs(cy - 300)).toBeLessThan(40)
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(8000))

describe('GraphView', () => {
  it('draws every node inside the canvas once the layout has settled', async () => {
    render(<GraphView {...props()} />)
    await settle()

    const centres = lastNodeCentres()

    expect(centres).toHaveLength(6)

    for (const [x, y] of centres) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(800)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(600)
    }
  })

  it('still draws the nodes when the graph shrinks to a neighbourhood (local graph)', async () => {
    const view = render(<GraphView {...props()} />)

    await settle()

    const local = buildGraph([indexNote('A/a1.md', '[[a2]]'), indexNote('A/a2.md', ''), indexNote('A/a3.md', '[[a1]]')])

    view.rerender(<GraphView {...props(local, { selected: 'A/a1.md' })} />)
    await settle()

    const centres = lastNodeCentres()

    expect(centres).toHaveLength(3)
    expectCentred(centres)

    for (const [x, y] of centres) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(800)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(600)
    }
  })

  it('shrinks to a neighbourhood from the very first render too (before the first layout ends)', async () => {
    const local = buildGraph([indexNote('A/a1.md', '[[a2]]'), indexNote('A/a2.md', ''), indexNote('A/a3.md', '[[a1]]')])
    const view = render(<GraphView {...props()} />)

    await act(() => vi.advanceTimersByTimeAsync(100))
    view.rerender(<GraphView {...props(local, { selected: 'A/a1.md' })} />)
    await settle()

    expect(lastNodeCentres()).toHaveLength(3)

    for (const [x, y] of lastNodeCentres()) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(800)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(600)
    }
  })
})

describe('GraphView with a lopsided vault', () => {
  const sizes: [string, number][] = [
    ['F0', 30],
    ['F1', 5],
    ['F2', 3],
    ['F3', 2]
  ]

  const many = buildGraph(
    sizes.flatMap(([folder, n], f) =>
      Array.from({ length: n }, (_, i) =>
        indexNote(`${folder}/n${i}.md`, `[[n${(i + 1) % n}]] [[n${(i + 3) % n}]] ${i === 0 ? `[[F${(f + 1) % 4}/n0]]` : ''}`)
      )
    )
  )

  const legendFolders = sizes.map(([folder]) => folder)

  it('refits the view when it shrinks to one far-off cluster', async () => {
    const view = render(<GraphView {...props(many, { legendFolders })} />)

    await settle()

    const small = buildGraph(Array.from({ length: 3 }, (_, i) => indexNote(`F2/n${i}.md`, `[[n${(i + 1) % 3}]]`)))

    view.rerender(<GraphView {...props(small, { legendFolders })} />)
    await settle()

    const centres = lastNodeCentres()

    expect(centres).toHaveLength(3)
    expectCentred(centres)
  })

  it('stays centred when it opens on a remembered layout that sits far from the origin', async () => {
    const positions = Object.fromEntries(many.nodes.map((node, i) => [node.id, [400 + (i % 7) * 15, (i % 5) * 15] as [number, number]]))

    render(<GraphView {...props(many, { legendFolders, positions })} />)
    await settle()

    const centres = lastNodeCentres()

    expect(centres).toHaveLength(many.nodes.length)
    expectCentred(centres)
  })
})
