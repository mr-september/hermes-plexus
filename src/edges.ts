/**
 * Edge drawing in the nested graph: classification by where the two notes sit in the folder tree, one drawn
 * line per linked pair, and viewport culling. Pure (no DOM), so the rules can be tested without painting.
 * See docs/edge-treatment.md.
 */

import type { GraphNode } from './model'

/** From the two notes' `dir` and `folder` alone, in this order: same folder, same top-level folder, otherwise. */
export type EdgeClass = 'across' | 'compartment' | 'top'

export const edgeClass = (a: Pick<GraphNode, 'dir' | 'folder'>, b: Pick<GraphNode, 'dir' | 'folder'>): EdgeClass =>
  a.dir === b.dir ? 'compartment' : a.folder !== '' && a.folder === b.folder ? 'top' : 'across'

export interface DrawnEdge<N> {
  class: EdgeClass
  source: N
  target: N
}

/**
 * One edge per linked pair for drawing: A->B and B->A would otherwise be coincident strokes that accumulate to a
 * stronger line, an accident of how links are stored. The model's edges and counts are untouched.
 */
export function drawnEdges<N extends Pick<GraphNode, 'dir' | 'folder' | 'id'>>(
  nodes: ReadonlyMap<string, N>,
  edges: readonly { source: string; target: string }[]
): DrawnEdge<N>[] {
  const seen = new Set<string>()
  const out: DrawnEdge<N>[] = []

  for (const { source, target } of edges) {
    const s = nodes.get(source)
    const t = nodes.get(target)
    const key = source < target ? `${source}\0${target}` : `${target}\0${source}`

    if (!s || !t || seen.has(key)) {
      continue
    }

    seen.add(key)
    out.push({ class: edgeClass(s, t), source: s, target: t })
  }

  return out
}

/**
 * Whether a segment can touch the view box (`margin` grows it, for the stroke's width). The segment's own bounding
 * box is tested, not its endpoints: a segment with both ends outside the view may still cross it.
 */
export const segmentInView = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  view: { bottom: number; left: number; right: number; top: number },
  margin: number
): boolean =>
  Math.max(a.x, b.x) >= view.left - margin &&
  Math.min(a.x, b.x) <= view.right + margin &&
  Math.max(a.y, b.y) >= view.top - margin &&
  Math.min(a.y, b.y) <= view.bottom + margin
