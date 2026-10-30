import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GraphView, type GraphViewProps } from './graph-view'
import { buildGraph, indexNote, type VaultGraph } from './model'
import { compartmentOf, computeGeometry, type Geometry } from './regions'

type Call = [string, unknown[]]

let calls: Call[] = []
let observers: (() => void)[] = []
let rect = { height: 600, width: 800 }

beforeEach(() => {
  calls = []
  observers = []
  rect = { height: 600, width: 800 }
  vi.useFakeTimers()

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      disconnect() {}
      observe() {
        observers.push(this.callback)
        this.callback()
      }
      unobserve() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        bottom: rect.height,
        height: rect.height,
        left: 0,
        right: rect.width,
        toJSON: () => ({}),
        top: 0,
        width: rect.width,
        x: 0,
        y: 0
      }) as DOMRect
  )
  HTMLElement.prototype.setPointerCapture = () => undefined
  // Text is measured in the transformed (world) space at the font size the view set, as a real canvas does.
  let fontPx = 11

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy(
      {},
      {
        get: (_target, name: string) =>
          name === 'measureText'
            ? (text: string) => ({ width: fontPx * 0.6 * text.length })
            : (...args: unknown[]) => void calls.push([name, args]),
        // Property writes are recorded too, so a region disc (arc, then style writes, then fill) differs from a note disc (arc, fill).
        set: (_target, name: string, value: unknown) => {
          if (name === 'font') {
            fontPx = Number.parseFloat(/(\d+(?:\.\d+)?(?:e-?\d+)?)px/.exec(String(value))?.[1] ?? '11')
          }

          calls.push(['set', [name, value]])

          return true
        }
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

// ---- nested folder regions -------------------------------------------------------------------

const unique = (dir: string, i: number) => `${dir.replaceAll('/', '_') || 'root'}_n${i}`

/** A ring of notes in `dir`, titled uniquely across the vault so links resolve. */
const ring = (dir: string, n: number, extra = '') =>
  Array.from({ length: n }, (_, i) =>
    indexNote(`${dir ? `${dir}/` : ''}${unique(dir, i)}.md`, `[[${unique(dir, (i + 1) % n)}]] ${i === 0 ? extra : ''}`)
  )

const tree = buildGraph([
  ...ring('', 3),
  ...ring('A', 8, '[[D_n0]]'),
  ...ring('A/B', 6),
  ...ring('A/B/C', 5, '[[A_n1]]'),
  ...ring('D', 6)
])

const nestedProps = (graph = tree, over: Partial<GraphViewProps> = {}) =>
  props(graph, { cluster: 'nested', legendFolders: ['', 'A', 'D'], ...over })

type Paint = Call[]

/** The recorded calls split into paints (each begins at setTransform). */
function paintsFrom(index = 0): Paint[] {
  const out: Paint[] = []

  for (const call of calls.slice(index)) {
    if (call[0] === 'setTransform') {
      out.push([])
    }

    out.at(-1)?.push(call)
  }

  return out
}

const arcs = (paint: Paint, follower: (name: string) => boolean): [number, number, number][] =>
  paint.flatMap((call, i) =>
    call[0] === 'arc' && follower(paint[i + 1]?.[0] ?? '') ? [call[1].slice(0, 3) as [number, number, number]] : []
  )

/** Note discs: an arc straight followed by fill. Region discs have style writes in between. */
const noteDiscs = (paint: Paint) => arcs(paint, name => name === 'fill')
const regionDiscs = (paint: Paint) => arcs(paint, name => name === 'set')

const transformOf = (paint: Paint) => {
  const [tx, ty] = paint.find(call => call[0] === 'translate')![1] as number[]
  const [k] = paint.find(call => call[0] === 'scale')![1] as number[]

  return { k: k!, tx: tx!, ty: ty! }
}

const lastPaint = () => paintsFrom().at(-1)!

/** Largest distance by which a painted note sticks out of its compartment. */
function overshoot(paint: Paint, graph: VaultGraph, geometry: Geometry): number {
  const discs = noteDiscs(paint)

  expect(discs).toHaveLength(graph.nodes.length)

  return Math.max(
    ...discs.map(([x, y, r], i) => {
      const comp = compartmentOf(geometry, graph.nodes[i]!.dir)!

      return Math.hypot(x - comp.x, y - comp.y) + r - comp.r
    })
  )
}

const expectContainedThroughout = (from: number, graph: VaultGraph, geometry: Geometry) => {
  const all = paintsFrom(from)

  expect(all.length).toBeGreaterThan(0)

  for (const paint of all) {
    expect(overshoot(paint, graph, geometry)).toBeLessThanOrEqual(1e-6)
  }
}

describe('GraphView nested folder regions', () => {
  const geometry = computeGeometry(tree.nodes)

  it('paints every note wholly inside its folder compartment, from the first paint on and through the settle', async () => {
    render(<GraphView {...nestedProps()} />)
    await settle()

    expectContainedThroughout(0, tree, geometry)
    // Regions are drawn first, beneath the notes.
    expect(regionDiscs(lastPaint()).length).toBeGreaterThan(3)

    // The vault root is geometry only: its enclosing disc is not drawn, the top-level folders' discs are.
    const radii = regionDiscs(lastPaint()).map(([, , r]) => r)
    const drawn = (r: number) => radii.some(item => Math.abs(item - r) < 1e-6)

    expect(drawn(geometry.regions.get('')!.r)).toBe(false)
    expect(drawn(geometry.regions.get('A')!.r)).toBe(true)
  })

  it('keeps containment through a layout-mode switch both ways, and never carries positions across it', async () => {
    const view = render(<GraphView {...props(tree, { legendFolders: ['', 'A', 'D'] })} />)

    await settle()

    const mark = calls.length

    view.rerender(<GraphView {...nestedProps()} />)
    await settle()
    expectContainedThroughout(mark, tree, geometry)

    view.rerender(<GraphView {...props(tree, { legendFolders: ['', 'A', 'D'] })} />)
    await settle()
    expect(noteDiscs(lastPaint())).toHaveLength(tree.nodes.length)
  })

  it('maps notes through a shrinking and a growing repack without ever painting one outside its new compartment', async () => {
    const grown = buildGraph([...ring('', 3), ...ring('A', 70), ...ring('A/B', 6), ...ring('A/B/C', 5), ...ring('D', 6)])
    const shrunk = buildGraph([...ring('', 3), ...ring('A', 2), ...ring('A/B', 6), ...ring('A/B/C', 5), ...ring('D', 6)])
    const view = render(<GraphView {...nestedProps(grown)} />)

    await settle()

    const mark = calls.length

    expect(compartmentOf(computeGeometry(shrunk.nodes), 'A')!.r).toBeLessThan(compartmentOf(computeGeometry(grown.nodes), 'A')!.r)

    view.rerender(<GraphView {...nestedProps(shrunk)} />)
    await settle()
    expectContainedThroughout(mark, shrunk, computeGeometry(shrunk.nodes))

    const next = calls.length

    view.rerender(<GraphView {...nestedProps(tree)} />)
    await settle()
    expectContainedThroughout(next, tree, geometry)
  })

  it('does not repack or move the camera when filters or the local graph change what is shown', async () => {
    const view = render(<GraphView {...nestedProps()} />)

    await settle()

    const before = regionDiscs(lastPaint())
    const camera = transformOf(lastPaint())
    const shown = buildGraph([...ring('A', 8), ...ring('A/B', 6)])

    view.rerender(<GraphView {...nestedProps(shown, { fullGraph: tree, hiddenFolders: new Set(['D', '']) })} />)
    await settle()

    expect(regionDiscs(lastPaint())).toEqual(before)
    expect(transformOf(lastPaint())).toEqual(camera)
  })

  describe('navigation', () => {
    const canvas = () => document.querySelector('canvas')!
    const labelOf = (text: string) => lastPaint().find(call => call[0] === 'fillText' && call[1][0] === text)

    /** Screen point on a region's drawn label. */
    const labelPoint = (text: string) => {
      const call = labelOf(text)

      expect(call, `label ${text}`).toBeDefined()

      const { k, tx, ty } = transformOf(lastPaint())
      const [, x, y] = call![1] as [string, number, number]

      return { clientX: x * k + tx, clientY: y * k + ty + 6 }
    }

    const click = (point: { clientX: number; clientY: number }) => {
      fireEvent.pointerDown(canvas(), { ...point, pointerId: 1 })
      fireEvent.pointerUp(canvas(), { ...point, pointerId: 1 })
    }

    /** How the last paint frames a region: its centre on screen and its on-screen radius. */
    const framing = (id: string) => {
      const region = computeGeometry(tree.nodes).regions.get(id)!
      const { k, tx, ty } = transformOf(lastPaint())

      return { k, r: region.r * k, x: region.x * k + tx, y: region.y * k + ty }
    }

    const settleCamera = () => act(() => vi.advanceTimersByTimeAsync(1500))
    const path = () => [...screen.getByRole('navigation').querySelectorAll('button')].map(button => button.textContent)

    it('clicking a region label frames that folder, recursively down to the deepest one, beyond the global Fit cap', async () => {
      render(<GraphView {...nestedProps()} />)
      await settle()

      const whole = transformOf(lastPaint()).k

      click(labelPoint('A'))
      await settleCamera()

      let view = framing('A')

      expect(view.x).toBeCloseTo(400, 3)
      expect(view.y).toBeCloseTo(300, 3)
      expect(view.r).toBeCloseTo(252, 3)
      expect(view.k).toBeGreaterThan(whole)

      click(labelPoint('B'))
      await settleCamera()
      click(labelPoint('C'))
      await settleCamera()

      view = framing('A/B/C')
      expect(view.x).toBeCloseTo(400, 3)
      expect(view.y).toBeCloseTo(300, 3)
      expect(view.r).toBeCloseTo(252, 3)
      // Far past the 1.8 cap of the global Fit action (the ceiling's widening past 6 is covered in camera.test.ts).
      expect(view.k).toBeGreaterThan(5)
    })

    it('shows the path to the camera, and a step of it (or Escape) frames the ancestor', async () => {
      render(<GraphView {...nestedProps()} />)
      await settle()
      click(labelPoint('A'))
      await settleCamera()
      click(labelPoint('B'))
      await settleCamera()
      click(labelPoint('C'))
      await settleCamera()

      expect(path()).toEqual(['Vault', 'A', 'B', 'C'])

      fireEvent.keyDown(canvas(), { key: 'Escape' })
      await settleCamera()
      expect(path()).toEqual(['Vault', 'A', 'B'])
      expect(framing('A/B').x).toBeCloseTo(400, 3)
      expect(framing('A/B').r).toBeCloseTo(252, 3)

      fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'A' }))
      await settleCamera()
      expect(path()).toEqual(['Vault', 'A'])
      expect(framing('A').r).toBeCloseTo(252, 3)

      fireEvent.keyDown(canvas(), { key: 'Escape' })
      await settleCamera()
      expect(path()).toEqual(['Vault'])

      const root = computeGeometry(tree.nodes).regions.get('')!
      const { k, tx, ty } = transformOf(lastPaint())

      expect(root.x * k + tx).toBeCloseTo(400, 3)
      expect(root.y * k + ty).toBeCloseTo(300, 3)
      expect(k).toBeLessThanOrEqual(1.8 + 1e-9)
    })

    it('stays framed on the same folder when the viewport is resized', async () => {
      render(<GraphView {...nestedProps()} />)
      await settle()
      click(labelPoint('A'))
      await settleCamera()

      rect = { height: 300, width: 400 }
      act(() => observers.forEach(callback => callback()))
      await settleCamera()

      const view = framing('A')

      expect(view.x).toBeCloseTo(200, 3)
      expect(view.y).toBeCloseTo(150, 3)
      expect(view.r).toBeCloseTo(102, 3)
    })

    it('pans on a drag that starts on an empty part of the map, and a plain click there does nothing', async () => {
      render(<GraphView {...nestedProps()} />)
      await settle()

      const before = transformOf(lastPaint())
      const corner = { clientX: 4, clientY: 4 }

      click(corner)
      await settleCamera()
      expect(transformOf(lastPaint())).toEqual(before)

      fireEvent.pointerDown(canvas(), { ...corner, pointerId: 1 })
      fireEvent.pointerMove(canvas(), { clientX: 54, clientY: 34, pointerId: 1 })
      fireEvent.pointerUp(canvas(), { clientX: 54, clientY: 34, pointerId: 1 })
      await settleCamera()

      const after = transformOf(lastPaint())

      expect(after.tx - before.tx).toBeCloseTo(50, 6)
      expect(after.ty - before.ty).toBeCloseTo(30, 6)
      expect(after.k).toBe(before.k)
    })

    it('keeps a dragged note inside its compartment even when the pointer goes far outside it', async () => {
      render(<GraphView {...nestedProps()} />)
      await settle()

      const [x, y] = noteDiscs(lastPaint())[10]!
      const { k, tx, ty } = transformOf(lastPaint())
      const start = { clientX: x * k + tx, clientY: y * k + ty }
      const mark = calls.length

      fireEvent.pointerDown(canvas(), { ...start, pointerId: 1 })
      fireEvent.pointerMove(canvas(), { clientX: -4000, clientY: -4000, pointerId: 1 })
      await act(() => vi.advanceTimersByTimeAsync(400))
      fireEvent.pointerMove(canvas(), { clientX: 9000, clientY: 120, pointerId: 1 })
      await act(() => vi.advanceTimersByTimeAsync(400))
      expectContainedThroughout(mark, tree, geometry)
      fireEvent.pointerUp(canvas(), { clientX: 9000, clientY: 120, pointerId: 1 })
    })

    it('holds a pinned note inside its compartment', async () => {
      const view = render(<GraphView {...nestedProps()} />)

      await settle()

      const mark = calls.length

      view.rerender(<GraphView {...nestedProps(tree, { pinned: new Set([tree.nodes[12]!.id]) })} />)
      await settle()
      expectContainedThroughout(mark, tree, geometry)
    })
  })
})

describe('GraphView position persistence', () => {
  const firstPaintDiscs = () => noteDiscs(paintsFrom()[0]!)
  const near = (a: [number, number, number][], b: [number, number][], tol: number) =>
    a.every(([x, y], i) => Math.hypot(x - b[i]![0], y - b[i]![1]) <= tol)

  it('restores compartment-relative positions in nested mode and ignores absolute ones', async () => {
    const nestedPositions = Object.fromEntries(
      tree.nodes.map((node, i) => [node.id, [node.dir, Math.cos(i) * 0.4, Math.sin(i) * 0.4] as [string, number, number]])
    )
    const comp = (dir: string) => compartmentOf(computeGeometry(tree.nodes), dir)!
    const wanted = tree.nodes.map((node): [number, number] => {
      const [, u, v] = nestedPositions[node.id]!

      return [comp(node.dir).x + u * comp(node.dir).r, comp(node.dir).y + v * comp(node.dir).r]
    })

    calls = []
    render(<GraphView {...nestedProps(tree, { nestedPositions })} />)
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(near(firstPaintDiscs(), wanted, 6)).toBe(true)

    // Legacy absolute positions (all far from any compartment) are never used by nested mode.
    cleanup()
    calls = []

    const absolute = Object.fromEntries(tree.nodes.map(node => [node.id, [5000, 5000] as [number, number]]))

    render(<GraphView {...nestedProps(tree, { positions: absolute })} />)
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(overshoot(paintsFrom()[0]!, tree, computeGeometry(tree.nodes))).toBeLessThanOrEqual(1e-6)
  })

  it('uses absolute positions only under the layout they were saved for (absent mode = legacy, accepted by folder/none)', async () => {
    const positions = Object.fromEntries(tree.nodes.map((node, i) => [node.id, [3000 + i, 3000] as [number, number]]))
    const wanted = tree.nodes.map((_, i): [number, number] => [3000 + i, 3000])
    const params = { legendFolders: ['', 'A', 'D'], positions }

    for (const [positionsMode, used] of [
      [undefined, true],
      ['folder', true],
      ['none', false]
    ] as const) {
      cleanup()
      calls = []
      render(<GraphView {...props(tree, { ...params, positionsMode })} />)
      await act(() => vi.advanceTimersByTimeAsync(50))
      expect(near(firstPaintDiscs(), wanted, 20), String(positionsMode)).toBe(used)
    }
  })
})
