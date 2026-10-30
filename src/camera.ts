/** Pure camera maths for the graph: framing, zoom limits and the smooth zoom path between two views. */

import type { Disc, Geometry } from './regions'

export interface View {
  k: number
  x: number
  y: number
}

/** The legacy zoom range; nested mode widens it from the geometry. */
export const BASE_ZOOM = { max: 6, min: 0.1 }
const FIT_PAD = 48

/** The magnification at which a disc of radius `r` fits the viewport with padding, or null when undefined. */
export function fitScale(r: number, w: number, h: number): null | number {
  const side = Math.min(w, h)

  if (!(r > 0) || !(side > 0)) {
    return null
  }

  // Padding never eats more than three quarters of the half-extent, so tiny viewports still get a scale.
  const k = Math.max(side / 2 - FIT_PAD, side / 8) / r

  return Number.isFinite(k) && k > 0 ? k : null
}

/**
 * Shared zoom limits: the floor is the smaller of the legacy floor and the whole-map fit, the ceiling
 * the larger of the legacy ceiling and the fit of the smallest compartment holding a note.
 */
export function zoomLimits(geometry: Geometry | null, w: number, h: number): { max: number; min: number } {
  const root = geometry?.root === null || !geometry ? undefined : geometry.regions.get(geometry.root)
  const whole = root ? fitScale(root.r, w, h) : null
  const smallest = geometry ? fitScale(geometry.smallest, w, h) : null

  return {
    max: Math.max(BASE_ZOOM.max, smallest ?? 0),
    min: Math.min(BASE_ZOOM.min, whole ?? Infinity)
  }
}

export const clampScale = (k: number, limits: { max: number; min: number }): number =>
  Math.min(limits.max, Math.max(limits.min, k))

/** A view that puts world point (cx, cy) at the viewport centre. */
export const viewAt = (cx: number, cy: number, k: number, w: number, h: number): View => ({
  k,
  x: w / 2 - cx * k,
  y: h / 2 - cy * k
})

/** The view framing a disc, within the limits. Null when the viewport or disc is degenerate. */
export function frameDisc(disc: Disc, w: number, h: number, limits: { max: number; min: number }, cap = Infinity): null | View {
  const k = fitScale(disc.r, w, h)

  return k === null ? null : viewAt(disc.x, disc.y, clampScale(Math.min(k, cap), limits), w, h)
}

/**
 * Smooth zoom between two views (van Wijk & Nuij, "Smooth and efficient zooming and panning", 2003; the
 * path d3-zoom's `interpolateZoom` uses): it zooms out and back in over long jumps, so the user keeps
 * their bearings. Returns the view at t in [0, 1] and a suggested duration.
 */
export function zoomPath(from: View, to: View, w: number, h: number): { at: (t: number) => View; ms: number } {
  const rho = Math.SQRT2
  const rho2 = 2
  const rho4 = 4
  const ux0 = (w / 2 - from.x) / from.k
  const uy0 = (h / 2 - from.y) / from.k
  const ux1 = (w / 2 - to.x) / to.k
  const uy1 = (h / 2 - to.y) / to.k
  const w0 = w / from.k
  const w1 = w / to.k
  const dx = ux1 - ux0
  const dy = uy1 - uy0
  const d2 = dx * dx + dy * dy
  let S: number
  let at: (t: number) => [number, number, number]

  if (d2 < 1e-12) {
    S = Math.log(w1 / w0) / rho
    at = t => [ux0, uy0, w0 * Math.exp(rho * t * S)]
  } else {
    const d1 = Math.sqrt(d2)
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1)
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1)
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)

    S = (r1 - r0) / rho
    at = t => {
      const s = t * S
      const coshr0 = Math.cosh(r0)
      const u = (w0 / (rho2 * d1)) * (coshr0 * Math.tanh(rho * s + r0) - Math.sinh(r0))

      return [ux0 + u * dx, uy0 + u * dy, (w0 * coshr0) / Math.cosh(rho * s + r0)]
    }
  }

  return {
    at: t => {
      if (t >= 1) {
        return to
      }

      const [cx, cy, width] = at(t)

      return viewAt(cx, cy, w / width, w, h)
    },
    ms: Math.min(900, Math.max(320, Math.abs(S) * 700))
  }
}
