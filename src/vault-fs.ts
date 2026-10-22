/**
 * The vault's disk door: thin wrappers over the Electron file bridge. Every call
 * resolves a result instead of throwing so the UI can show a failure where it
 * happened. The bridge is injected so tests can fake a disk.
 */

import type { Bridge } from './bridge'
import { isValidNoteName, noteTitle, relativeTo, type VaultNote } from './model'

export type Fail = { error: string; ok: false }
export type Result<T = object> = ({ ok: true } & T) | Fail

const fail = (error: unknown): Fail => ({
  error: error instanceof Error ? error.message : String(error),
  ok: false
})

export const sepFor = (root: string): string => (root.includes('\\') ? '\\' : '/')

export const joinPath = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}${sepFor(dir)}${name}`

/** Absolute path of a vault-relative folder ('' = the root). */
export const dirPath = (root: string, dirRel: string): string =>
  dirRel ? joinPath(root, dirRel.replace(/\//g, sepFor(root))) : root

export const BAD_NAME = 'Names cannot be empty or contain \\ / : * ? " < > |'

/** Every `.md` under `root`, skipping dot-folders and `hidden` folder names. */
export async function scanVault(
  fs: Bridge,
  root: string,
  hidden: readonly string[]
): Promise<Result<{ notes: VaultNote[] }>> {
  const skip = new Set(hidden.map(name => name.toLowerCase()))
  const notes: VaultNote[] = []
  let failure: null | string = null

  const walk = async (dir: string): Promise<void> => {
    const { entries, error } = await fs.readDir(dir)

    if (error) {
      if (dir === root) {
        failure = `Cannot read vault folder (${error})`
      }

      return
    }

    const subdirs: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!entry.name.startsWith('.') && !skip.has(entry.name.toLowerCase())) {
          subdirs.push(entry.path)
        }
      } else if (/\.md$/i.test(entry.name)) {
        const rel = relativeTo(root, entry.path)

        if (rel) {
          notes.push({ path: entry.path, rel })
        }
      }
    }

    await Promise.all(subdirs.map(walk))
  }

  await walk(root)

  return failure ? fail(failure) : { notes: notes.sort((a, b) => a.rel.localeCompare(b.rel)), ok: true }
}

export interface NoteText {
  /** False when the file was truncated by the bridge's preview cap or is binary. */
  editable: boolean
  text: string
}

export async function readNote(fs: Bridge, path: string): Promise<Result<NoteText>> {
  try {
    const res = await fs.readFileText(path)

    if (!('text' in res)) {
      return fail(res.message || res.error)
    }

    return { editable: !res.truncated && !res.binary, ok: true, text: res.text }
  } catch (error) {
    return fail(error)
  }
}

export type WriteResult = Fail & { conflict?: true } | { ok: true }

/** Writes `text`; when `base` is given the file must still hold it, else `{ conflict: true }`. */
export async function writeNote(fs: Bridge, path: string, text: string, base: null | string): Promise<WriteResult> {
  try {
    if (base !== null) {
      const current = await readNote(fs, path)

      if (current.ok && current.text !== base) {
        return { conflict: true, error: 'Changed on disk since it was opened', ok: false }
      }
    }

    await fs.writeTextFile!(path, text)

    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

/** Creates `<dir>/<name>.md`; refuses to overwrite an existing note. */
export async function createNote(fs: Bridge, dir: string, name: string, body?: string): Promise<Result<{ path: string }>> {
  if (!isValidNoteName(name)) {
    return fail(BAD_NAME)
  }

  const clean = name.trim().replace(/\.md$/i, '')
  const path = joinPath(dir, `${clean}.md`)

  try {
    if ((await readNote(fs, path)).ok) {
      return fail(`"${clean}" already exists`)
    }

    await fs.writeTextFile!(path, body ?? `# ${noteTitle(`${clean}.md`)}\n`)

    return { ok: true, path }
  } catch (error) {
    return fail(error)
  }
}

export async function renameNote(fs: Bridge, path: string, name: string): Promise<Result<{ path: string }>> {
  if (!isValidNoteName(name)) {
    return fail(BAD_NAME)
  }

  try {
    const { path: next } = await fs.renamePath!(path, `${name.trim().replace(/\.md$/i, '')}.md`)

    return { ok: true, path: next }
  } catch (error) {
    return fail(error)
  }
}

/** Moves a note into another folder: write the copy first, trash the original only after it exists. */
export async function moveNote(fs: Bridge, from: string, destDir: string): Promise<Result<{ path: string }>> {
  const name = from.split(/[\\/]/).pop()!
  const to = joinPath(destDir, name)

  try {
    const source = await readNote(fs, from)

    if (!source.ok) {
      return source
    }

    if (!source.editable) {
      return fail('This note is too large to move safely')
    }

    if ((await readNote(fs, to)).ok) {
      return fail(`"${name}" already exists in the destination`)
    }

    await fs.writeTextFile!(to, source.text)
    await fs.trashPath!(from)

    return { ok: true, path: to }
  } catch (error) {
    return fail(error)
  }
}

/** Recoverable delete (OS trash). */
export async function trashNote(fs: Bridge, path: string): Promise<Result> {
  try {
    await fs.trashPath!(path)

    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

export async function chooseVaultFolder(fs: Bridge, defaultPath?: string): Promise<null | string> {
  const picked = await fs.selectPaths?.({ defaultPath, directories: true, title: 'Choose your vault folder' })

  return picked?.[0] ?? null
}
