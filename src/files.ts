/**
 * The vault's disk interface, keyed by absolute path so the store and the tests stay simple, and
 * its one production implementation over Hermes Desktop's folder-scoped `ctx.files`. The plugin
 * never touches the desktop's raw file bridge: every call names a folder the user granted and a
 * path inside it, and the app's main process refuses anything that leaves that folder.
 */

import type { PluginFiles } from '@hermes/plugin-sdk'

import { relativeTo } from './model'

export interface DirEntry {
  isDirectory: boolean
  name: string
  path: string
}

export interface ReadFileResult {
  binary?: boolean
  path: string
  text: string
  truncated?: boolean
}

export interface ReadFileError {
  error: string
  message: string
  ok: false
  path?: string
}

export interface VaultFs {
  /** Ask the user for a folder; resolves its absolute path, or null when they cancel. */
  pickFolder?: () => Promise<null | string>
  readDir: (path: string) => Promise<{ entries: DirEntry[]; error?: string; truncated?: boolean }>
  readFileDataUrl?: (path: string) => Promise<ReadFileError | string>
  readFileText: (path: string) => Promise<ReadFileError | ReadFileResult>
  renamePath?: (path: string, newName: string) => Promise<{ path: string }>
  trashPath?: (path: string) => Promise<boolean>
  /** `exclusive` refuses to replace an existing file. */
  writeTextFile?: (path: string, content: string, options?: { exclusive?: boolean }) => Promise<{ path: string }>
}

/** `readDir`'s error when no folder the user granted holds the path. */
export const NO_ACCESS = 'no-access'

interface Grant {
  id: string
  path: string
}

interface Located {
  folder: string
  rel: string
}

const trimEnd = (path: string): string => path.replace(/[\\/]+$/, '')

const sepOf = (path: string): string => (path.includes('\\') ? '\\' : '/')

/** Adapts `ctx.files` to absolute paths: a path is resolved against the folders the user granted. */
export function vaultFsFrom(files: PluginFiles): VaultFs {
  let granted: Grant[] | null = null

  const refresh = async (): Promise<Grant[]> => (granted = await files.folders())

  /** The granted folder holding `abs` (the deepest one when grants nest), and the path inside it. */
  const locate = async (abs: string): Promise<Located | null> => {
    const find = (list: readonly Grant[]): Located | null => {
      let best: (Located & { length: number }) | null = null

      for (const { id, path } of list) {
        const rel = trimEnd(abs).toLowerCase() === trimEnd(path).toLowerCase() ? '' : relativeTo(path, abs)

        if (rel !== null && (!best || path.length > best.length)) {
          best = { folder: id, length: path.length, rel }
        }
      }

      return best && { folder: best.folder, rel: best.rel }
    }

    return find(granted ?? (await refresh())) ?? find(await refresh())
  }

  const absOf = (folderId: string, rel: string): string => {
    const base = granted?.find(item => item.id === folderId)?.path ?? ''

    return rel ? `${trimEnd(base)}${sepOf(base)}${rel.replace(/\//g, sepOf(base))}` : base
  }

  const need = async (abs: string): Promise<Located> => {
    const at = await locate(abs)

    if (!at) {
      throw new Error(NO_ACCESS)
    }

    return at
  }

  const failure = (path: string, res: { error: string; message: string } | null): ReadFileError => ({
    error: res?.error ?? NO_ACCESS,
    message: res?.message ?? NO_ACCESS,
    ok: false,
    path
  })

  return {
    async pickFolder() {
      const res = await files.requestFolder()

      if (!res.ok) {
        throw new Error(res.message)
      }

      granted = null

      return res.folder?.path ?? null
    },

    async readDir(path) {
      const at = await locate(path)

      if (!at) {
        return { entries: [], error: NO_ACCESS }
      }

      const res = await files.list(at.folder, at.rel)

      return res.ok
        ? {
            entries: res.entries.map(entry => ({
              isDirectory: entry.isDirectory,
              name: entry.name,
              path: absOf(at.folder, entry.path)
            })),
            truncated: res.truncated
          }
        : { entries: [], error: res.message }
    },

    async readFileText(path) {
      const at = await locate(path)
      const res = at ? await files.readText(at.folder, at.rel) : null

      return res?.ok ? { path, text: res.text } : failure(path, res)
    },

    async readFileDataUrl(path) {
      const at = await locate(path)
      const res = at ? await files.readDataUrl(at.folder, at.rel) : null

      return res?.ok ? res.url : failure(path, res)
    },

    async writeTextFile(path, content, options) {
      const at = await need(path)
      const res = await files.writeText(at.folder, at.rel, content, options)

      if (!res.ok) {
        throw new Error(res.message)
      }

      return { path }
    },

    async renamePath(path, newName) {
      const at = await need(path)
      const res = await files.rename(at.folder, at.rel, newName)

      if (!res.ok) {
        throw new Error(res.message)
      }

      return { path: absOf(at.folder, res.path) }
    },

    async trashPath(path) {
      const at = await need(path)
      const res = await files.trash(at.folder, at.rel)

      if (!res.ok) {
        throw new Error(res.message)
      }

      return true
    }
  }
}
