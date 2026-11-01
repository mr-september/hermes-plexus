/**
 * Graph hiding by folder path. `hiddenInGraph` is a set of vault-relative folder paths: an entry hides the notes
 * whose folder is that path or lies under it (`A/B` covers `A/B/x` but not `A/BB`). The empty path is the notes
 * directly in the vault root, never the whole vault. Pure, so the semantics are tested without the view.
 */

import type { GraphNode } from './model'

export const parentOf = (dir: string): string => (dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')

/** Whether `entry` hides a note in folder `dir`. */
export const covers = (entry: string, dir: string): boolean =>
  entry === '' ? dir === '' : dir === entry || dir.startsWith(`${entry}/`)

/**
 * The entry that hides folder `dir`: its own, else the deepest covering ancestor, else null. The empty entry
 * only ever matches the empty folder.
 */
export function coveringEntry(entries: ReadonlySet<string>, dir: string): null | string {
  if (entries.has(dir)) {
    return dir
  }

  for (let up = parentOf(dir); up !== ''; up = parentOf(up)) {
    if (entries.has(up)) {
      return up
    }
  }

  return null
}

export const isHiddenDir = (entries: ReadonlySet<string>, dir: string): boolean => coveringEntry(entries, dir) !== null

/** Hide `path`. Entries are stored as given: a covered path adds nothing (and says what covers it), anything else is appended. */
export function hidePath(entries: readonly string[], path: string): { coveredBy: null | string; entries: string[] } {
  const coveredBy = coveringEntry(new Set(entries), path)

  return { coveredBy, entries: coveredBy === null ? [...entries, path] : [...entries] }
}

/** Remove exactly `path`; ancestor and descendant entries are untouched. */
export const showPath = (entries: readonly string[], path: string): string[] => entries.filter(entry => entry !== path)

/** Notes of the (unfiltered) graph that an entry covers; for the empty entry, the root notes only. */
export const subtreeCount = (nodes: readonly Pick<GraphNode, 'dir'>[], entry: string): number =>
  nodes.reduce((count, node) => count + (covers(entry, node.dir) ? 1 : 0), 0)

/** Every folder of the scan, intermediate ones included; the empty path only when a note sits in the root. */
export function knownFolders(nodes: readonly Pick<GraphNode, 'dir'>[]): Set<string> {
  const known = new Set<string>()

  for (const { dir } of nodes) {
    if (dir === '') {
      known.add('')
    }

    for (let at = dir; at !== '' && !known.has(at); at = parentOf(at)) {
      known.add(at)
    }
  }

  return known
}
