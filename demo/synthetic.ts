// Synthetic vaults with controllable size, folder depth/branching/skew and link locality, for the
// nested-folder tests and the measurement script. Deterministic for a given seed.
import { buildGraph, indexNote, type VaultGraph } from '../src/model'

export interface SyntheticOptions {
  /** Share of links that cross to another folder (default 0.1). */
  crossFraction?: number
  /** Folder levels below the root (default 2). */
  depth?: number
  /** Subfolders per folder (default 3). */
  branching?: number
  /** One folder per note, nested `depth` deep (F close to N). */
  folderPerNote?: boolean
  /** Folder name for the b-th subfolder at a level (0 = top level); defaults to `f<b>`. */
  folderName?: (level: number, b: number) => string
  /** Links per note (default 2). */
  links?: number
  notes: number
  seed?: number
  /** Zipf exponent of the notes-per-folder distribution; 0 is uniform (default 0). */
  skew?: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0

    let t = a

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Vault-relative paths and wikilink bodies. */
export function syntheticNotes(options: SyntheticOptions): { content: string; rel: string }[] {
  const { crossFraction = 0.1, notes, seed = 1, skew = 0 } = options
  const depth = options.depth ?? 2
  const branching = options.branching ?? 3
  const linksPer = options.links ?? 2
  const random = mulberry32(seed)
  const name = options.folderName ?? ((_level: number, b: number) => `f${b}`)

  // Every folder of a full `branching`-ary tree of `depth` levels, root excluded, capped by what N could fill.
  const dirs: string[] = []

  if (options.folderPerNote) {
    const top = Math.max(1, Math.round(Math.sqrt(notes)))

    for (let i = 0; i < notes; i++) {
      dirs.push(`g${i % top}/${Array.from({ length: Math.max(1, depth - 1) }, (_, level) => `f${i}_${level}`).join('/')}`)
    }
  } else {
    let level = ['']

    for (let d = 0; d < depth; d++) {
      level = level.flatMap(parent =>
        Array.from({ length: branching }, (_, b) => `${parent ? `${parent}/` : ''}${name(d, b)}`)
      )
      dirs.push(...level)

      if (dirs.length > notes) {
        break
      }
    }

    dirs.push('')
  }

  const weights = options.folderPerNote ? [] : dirs.map((_, i) => 1 / (i + 1) ** skew)
  const total = weights.reduce((a, b) => a + b, 0)

  const pick = (): string => {
    let x = random() * total

    for (let i = 0; i < dirs.length; i++) {
      x -= weights[i]!

      if (x <= 0) {
        return dirs[i]!
      }
    }

    return dirs[dirs.length - 1]!
  }

  const placed = Array.from({ length: notes }, (_, i) => {
    const dir = options.folderPerNote ? dirs[i]! : pick()

    return { dir, name: `n${i}`, rel: `${dir ? `${dir}/` : ''}n${i}.md` }
  })

  const byDir = new Map<string, number[]>()

  placed.forEach((note, i) => byDir.set(note.dir, [...(byDir.get(note.dir) ?? []), i]))

  return placed.map((note, i) => {
    const targets = new Set<string>()
    const own = byDir.get(note.dir)!

    for (let l = 0; l < linksPer && notes > 1; l++) {
      const pool = random() < crossFraction || own.length < 2 ? undefined : own
      const j = pool ? pool[Math.floor(random() * pool.length)]! : Math.floor(random() * notes)

      if (j !== i) {
        targets.add(placed[j]!.name)
      }
    }

    return { content: [...targets].map(name => `[[${name}]]`).join(' '), rel: note.rel }
  })
}

export const syntheticGraph = (options: SyntheticOptions): VaultGraph =>
  buildGraph(syntheticNotes(options).map(note => indexNote(note.rel, note.content)))
