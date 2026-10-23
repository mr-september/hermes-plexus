/**
 * The vault's disk door: thin wrappers over the vault file interface (`ctx.files` in the app).
 * Every call resolves a result instead of throwing so the UI can show a failure where it
 * happened. The interface is injected so tests can fake a disk.
 */

import { NO_ACCESS, type VaultFs } from './files'
import { IMAGE_EXT, isValidNoteName, noteTitle, relativeTo, type VaultNote } from './model'

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

/** Deeper than any real vault: only a symlink loop gets this far. */
export const MAX_DEPTH = 32
/** Folder listings per scan; a loop that branches would otherwise grow exponentially. */
export const MAX_FOLDERS = 10000

/** Something the scan could not fully cover, so notes may be missing from the vault. */
export interface ScanWarning {
  kind: 'depth' | 'folders' | 'truncated'
  /** Vault-relative folder where it first happened ('' = the vault folder). */
  path: string
}

/** Every `.md` (and image, for previews) under `root`, skipping dot-folders and `hidden` folder names. */
export async function scanVault(
  fs: VaultFs,
  root: string,
  hidden: readonly string[]
): Promise<Result<{ assets: VaultNote[]; notes: VaultNote[]; warnings: ScanWarning[] }>> {
  const skip = new Set(hidden.map(name => name.toLowerCase()))
  const notes: VaultNote[] = []
  const assets: VaultNote[] = []
  const warnings: ScanWarning[] = []
  let failure: null | string = null
  let listings = 0

  const warn = (kind: ScanWarning['kind'], dir: string) => {
    if (!warnings.some(item => item.kind === kind)) {
      warnings.push({ kind, path: relativeTo(root, dir) ?? '' })
    }
  }

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      return warn('depth', dir)
    }

    if (++listings > MAX_FOLDERS) {
      return warn('folders', dir)
    }

    const { entries, error, truncated } = await fs.readDir(dir)

    if (error) {
      if (dir === root) {
        failure = error === NO_ACCESS ? NO_ACCESS : `Cannot read vault folder (${error})`
      }

      return
    }

    if (truncated) {
      warn('truncated', dir)
    }

    const subdirs: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!entry.name.startsWith('.') && !skip.has(entry.name.toLowerCase())) {
          subdirs.push(entry.path)
        }
      } else {
        const isNote = /\.md$/i.test(entry.name)

        if (isNote || IMAGE_EXT.test(entry.name)) {
          const rel = relativeTo(root, entry.path)

          if (rel) {
            ;(isNote ? notes : assets).push({ path: entry.path, rel })
          }
        }
      }
    }

    await Promise.all(subdirs.map(sub => walk(sub, depth + 1)))
  }

  await walk(root, 0)

  const byRel = (a: VaultNote, b: VaultNote) => a.rel.localeCompare(b.rel)

  return failure ? fail(failure) : { assets: assets.sort(byRel), notes: notes.sort(byRel), ok: true, warnings }
}

export interface NoteText {
  /** False when the file came back truncated or binary. */
  editable: boolean
  text: string
}

export async function readNote(fs: VaultFs, path: string): Promise<Result<NoteText>> {
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
export async function writeNote(fs: VaultFs, path: string, text: string, base: null | string): Promise<WriteResult> {
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
export async function createNote(fs: VaultFs, dir: string, name: string, body?: string): Promise<Result<{ path: string }>> {
  if (!isValidNoteName(name)) {
    return fail(BAD_NAME)
  }

  const clean = name.trim().replace(/\.md$/i, '')
  const path = joinPath(dir, `${clean}.md`)

  try {
    if ((await readNote(fs, path)).ok) {
      return fail(`"${clean}" already exists`)
    }

    await fs.writeTextFile!(path, body ?? `# ${noteTitle(`${clean}.md`)}\n`, { exclusive: true })

    return { ok: true, path }
  } catch (error) {
    return fail(error)
  }
}

export async function renameNote(fs: VaultFs, path: string, name: string): Promise<Result<{ path: string }>> {
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
export async function moveNote(fs: VaultFs, from: string, destDir: string): Promise<Result<{ path: string }>> {
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

    await fs.writeTextFile!(to, source.text, { exclusive: true })
    await fs.trashPath!(from)

    return { ok: true, path: to }
  } catch (error) {
    return fail(error)
  }
}

/** Recoverable delete (OS trash). */
export async function trashNote(fs: VaultFs, path: string): Promise<Result> {
  try {
    await fs.trashPath!(path)

    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

/** An image as a data URL. */
export async function readDataUrl(fs: VaultFs, path: string): Promise<Result<{ url: string }>> {
  try {
    const res = await fs.readFileDataUrl?.(path)

    if (res === undefined) {
      return fail('Image preview needs a newer desktop app')
    }

    return typeof res === 'string' ? { ok: true, url: res } : fail(res.message || res.error)
  } catch (error) {
    return fail(error)
  }
}

/** The app's own folder picker; the folder picked becomes this plugin's grant. Null on cancel or refusal. */
export async function chooseVaultFolder(fs: VaultFs): Promise<null | string> {
  try {
    return (await fs.pickFolder?.()) ?? null
  } catch {
    return null
  }
}
