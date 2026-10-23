import type { VaultFs } from '../src/files'

/** An in-memory disk behind the vault file interface, with Windows-style paths. */
export class FakeDisk {
  files = new Map<string, string>()
  /** Image files by absolute path → their data URL. */
  images = new Map<string, string>()
  trashed: string[] = []
  readDirCalls: string[] = []
  writes: [string, string][] = []

  constructor(
    public root = 'C:\\v',
    files: Record<string, string> = {}
  ) {
    for (const [rel, text] of Object.entries(files)) {
      this.files.set(this.abs(rel), text)
    }
  }

  abs = (rel: string): string => `${this.root}\\${rel.replace(/\//g, '\\')}`

  text = (rel: string): string | undefined => this.files.get(this.abs(rel))

  bridge: VaultFs = {
    readDir: async dir => {
      this.readDirCalls.push(dir)

      const prefix = `${dir}\\`
      const seen = new Map<string, boolean>()

      for (const path of [...this.files.keys(), ...this.images.keys()]) {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length)
          const [head] = rest.split('\\')

          seen.set(head!, rest.includes('\\'))
        }
      }

      return {
        entries: [...seen].map(([name, isDirectory]) => ({ isDirectory, name, path: `${prefix}${name}` }))
      }
    },
    readFileText: async path =>
      this.files.has(path)
        ? { path, text: this.files.get(path)! }
        : { error: 'ENOENT', message: 'missing', ok: false, path },
    readFileDataUrl: async path =>
      this.images.has(path)
        ? this.images.get(path)!
        : { error: 'ENOENT', message: 'missing image', ok: false, path },
    renamePath: async (path, name) => {
      const next = path.replace(/[^\\]+$/, name)

      if (this.files.has(next)) {
        throw new Error(`"${name}" already exists`)
      }

      this.files.set(next, this.files.get(path)!)
      this.files.delete(path)

      return { path: next }
    },
    trashPath: async path => {
      this.trashed.push(path)
      this.files.delete(path)

      return true
    },
    writeTextFile: async (path, content, options) => {
      if (options?.exclusive && this.files.has(path)) {
        throw new Error('That file already exists.')
      }

      this.writes.push([path, content])
      this.files.set(path, content)

      return { path }
    }
  }
}
