import { describe, expect, it } from 'vitest'

import { clampScale, fitScale, frameDisc, viewAt, zoomLimits, zoomPath } from './camera'
import { buildGraph, indexNote } from './model'
import { buildGeometry, computeGeometry, EMPTY_GEOMETRY } from './regions'

const geometry = (...rels: string[]) => computeGeometry(buildGraph(rels.map(rel => indexNote(rel, ''))).nodes)
const many = (dir: string, n: number) => Array.from({ length: n }, (_, i) => `${dir}/n${i}.md`)

describe('zoom limits', () => {
  it('stay finite and legacy for empty geometry and zero-sized viewports', () => {
    expect(zoomLimits(EMPTY_GEOMETRY, 800, 600)).toEqual({ max: 6, min: 0.1 })
    expect(zoomLimits(null, 800, 600)).toEqual({ max: 6, min: 0.1 })
    expect(zoomLimits(geometry('A/x.md'), 0, 0)).toEqual({ max: 6, min: 0.1 })
    expect(fitScale(10, 0, 500)).toBeNull()
    expect(fitScale(0, 800, 600)).toBeNull()
    expect(Number.isFinite(fitScale(10, 20, 20)!)).toBe(true)
  })

  it('cover both ends of the hierarchy: whole-map fit below the floor, smallest compartment above the ceiling', () => {
    // Compartment radii chosen directly: a vault this large is what pushes the whole map past the legacy floor.
    const big = buildGeometry(new Map([['A', 3000], ['B', 3000], ['C', 3000], ['D', 11]]))
    const root = big.regions.get('')!
    const limits = zoomLimits(big, 800, 600)

    expect(limits.min).toBeLessThan(0.1)
    expect(limits.min).toBeCloseTo(fitScale(root.r, 800, 600)!, 9)
    expect(limits.max).toBeGreaterThan(6)
    expect(limits.max).toBeCloseTo(fitScale(big.smallest, 800, 600)!, 9)
    // A small vault needs neither: the legacy range already covers it.
    expect(zoomLimits(geometry(...many('A', 3)), 800, 600).min).toBe(0.1)
  })

  it('follow the viewport', () => {
    const g = buildGeometry(new Map([['A', 4000], ['B', 11]]))

    expect(zoomLimits(g, 400, 300).min).toBeLessThan(zoomLimits(g, 1600, 1200).min)
    expect(zoomLimits(g, 400, 300).max).toBeLessThan(zoomLimits(g, 1600, 1200).max)
  })
})

describe('framing', () => {
  it('centres the disc and is capped only where the caller caps it', () => {
    const disc = { r: 11, x: 100, y: -40 }
    const limits = { max: 40, min: 0.1 }
    const folder = frameDisc(disc, 800, 600, limits)!
    const fitted = frameDisc(disc, 800, 600, limits, 1.8)!

    expect(folder.k).toBeGreaterThan(20)
    expect(fitted.k).toBe(1.8)

    for (const view of [folder, fitted]) {
      expect(view.x + 100 * view.k).toBeCloseTo(400, 9)
      expect(view.y - 40 * view.k).toBeCloseTo(300, 9)
    }

    expect(frameDisc(disc, 800, 600, { max: 6, min: 0.1 })!.k).toBe(6)
    expect(frameDisc(disc, 0, 0, limits)).toBeNull()
  })

  it('clamps to the limits', () => {
    expect(clampScale(100, { max: 6, min: 0.1 })).toBe(6)
    expect(clampScale(0.001, { max: 6, min: 0.1 })).toBe(0.1)
  })
})

describe('zoom path', () => {
  it('starts and ends exactly on the two views and stays finite between them', () => {
    const from = viewAt(0, 0, 0.5, 800, 600)
    const to = viewAt(9000, -7000, 30, 800, 600)
    const path = zoomPath(from, to, 800, 600)

    expect(path.at(0).k).toBeCloseTo(from.k, 9)
    expect(path.at(1)).toEqual(to)

    for (let t = 0; t <= 1; t += 0.05) {
      const v = path.at(t)

      expect([v.k, v.x, v.y].every(Number.isFinite)).toBe(true)
    }

    // A long jump zooms out in the middle before zooming in.
    expect(Math.min(...[0.25, 0.5, 0.75].map(t => path.at(t).k))).toBeLessThan(from.k)
  })

  it('handles a pure zoom (same centre)', () => {
    const path = zoomPath(viewAt(5, 5, 1, 800, 600), viewAt(5, 5, 8, 800, 600), 800, 600)

    expect(path.at(0.5).k).toBeGreaterThan(1)
    expect(path.at(0.5).k).toBeLessThan(8)
  })
})
