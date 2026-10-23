import { describe, expect, it, vi } from 'vitest'

import type { PluginFiles } from '@hermes/plugin-sdk'

import { NO_ACCESS, type VaultFs, vaultFsFrom } from './files'
import { MAX_DEPTH, scanVault } from './vault-fs'

const ok = <T extends object>(extra: T) => ({ ok: true as const, ...extra })

/** A `ctx.files` stand-in that records calls; `V1` is the granted vault folder. */
function fakeFiles() {
  const calls: unknown[][] = []

  const files = {
    folders: async () => [{ id: 'V1', name: 'vault', path: 'C:\\Notes\\vault' }],
    list: vi.fn(async (...args: unknown[]) => {
      calls.push(['list', ...args])

      return ok({ entries: [{ isDirectory: false, name: 'a.md', path: 'sub/a.md' }], truncated: true })
    }),
    readDataUrl: vi.fn(async () => ok({ url: 'data:image/png;base64,AA' })),
    readText: vi.fn(async (...args: unknown[]) => {
      calls.push(['readText', ...args])

      return ok({ mtimeMs: 1, size: 1, text: 'hi' })
    }),
    rename: vi.fn(async (...args: unknown[]) => {
      calls.push(['rename', ...args])

      return ok({ path: 'sub/b.md' })
    }),
    requestFolder: vi.fn(async () => ok({ folder: { id: 'V2', name: 'x', path: 'D:\\x' } })),
    trash: vi.fn(async (...args: unknown[]) => {
      calls.push(['trash', ...args])

      return ok({})
    }),
    writeText: vi.fn(async (...args: unknown[]) => {
      calls.push(['writeText', ...args])

      return ok({ mtimeMs: 1, path: 'sub/a.md', size: 2 })
    })
  }

  return { calls, files: files as unknown as PluginFiles }
}

describe('vaultFsFrom (ctx.files)', () => {
  it('turns absolute paths into folder-id + relative-path calls and maps results back', async () => {
    const { calls, files } = fakeFiles()
    const fs = vaultFsFrom(files)

    const listing = await fs.readDir('C:\\Notes\\vault\\sub')

    expect(listing).toEqual({
      entries: [{ isDirectory: false, name: 'a.md', path: 'C:\\Notes\\vault\\sub\\a.md' }],
      truncated: true
    })
    expect(await fs.readFileText('c:/notes/vault/sub/a.md')).toEqual({ path: 'c:/notes/vault/sub/a.md', text: 'hi' })
    await fs.writeTextFile!('C:\\Notes\\vault\\sub\\a.md', 'x', { exclusive: true })
    expect(await fs.renamePath!('C:\\Notes\\vault\\sub\\a.md', 'b.md')).toEqual({ path: 'C:\\Notes\\vault\\sub\\b.md' })
    await fs.trashPath!('C:\\Notes\\vault\\sub\\b.md')

    expect(calls).toEqual([
      ['list', 'V1', 'sub'],
      ['readText', 'V1', 'sub/a.md'],
      ['writeText', 'V1', 'sub/a.md', 'x', { exclusive: true }],
      ['rename', 'V1', 'sub/a.md', 'b.md'],
      ['trash', 'V1', 'sub/b.md']
    ])
  })

  it('refuses a path outside every granted folder without calling the app', async () => {
    const { files } = fakeFiles()
    const fs = vaultFsFrom(files)

    expect(await fs.readDir('C:\\Notes\\other')).toEqual({ entries: [], error: NO_ACCESS })
    expect(await fs.readFileText('C:\\Notes\\vaultish\\a.md')).toMatchObject({ error: NO_ACCESS, ok: false })
    await expect(fs.trashPath!('C:\\Windows\\x.md')).rejects.toThrow(NO_ACCESS)
    expect(files.list).not.toHaveBeenCalled()
    expect(files.trash).not.toHaveBeenCalled()
  })

  it('surfaces the app’s refusal as a failure, and hands back the picked folder path', async () => {
    const { files } = fakeFiles()

    files.writeText = vi.fn(async () => ({ error: 'exists', message: 'That file already exists.', ok: false as const }))

    const fs = vaultFsFrom(files)

    await expect(fs.writeTextFile!('C:\\Notes\\vault\\a.md', 'x', { exclusive: true })).rejects.toThrow('already exists')
    expect(await fs.pickFolder!()).toBe('D:\\x')
  })
})

describe('scanVault limits', () => {
  /** `loop` inside every folder points back at its parent, as a symlink cycle would look through ctx.files. */
  const looping = (): VaultFs => ({
    readDir: async dir => ({
      entries: [
        { isDirectory: true, name: 'loop', path: `${dir}/loop` },
        { isDirectory: false, name: 'n.md', path: `${dir}/n.md` }
      ]
    }),
    readFileText: async path => ({ error: 'x', message: 'x', ok: false, path })
  })

  it('stops a symlink loop at the depth cap and says where', async () => {
    const res = await scanVault(looping(), '/v', [])

    expect(res.ok && res.notes).toHaveLength(MAX_DEPTH + 1)
    expect(res.ok && res.warnings).toEqual([{ kind: 'depth', path: Array(MAX_DEPTH + 1).fill('loop').join('/') }])
  })

  it('warns when a folder listing was truncated', async () => {
    const fs: VaultFs = {
      readDir: async () => ({ entries: [{ isDirectory: false, name: 'a.md', path: '/v/a.md' }], truncated: true }),
      readFileText: async path => ({ error: 'x', message: 'x', ok: false, path })
    }

    expect(await scanVault(fs, '/v', [])).toMatchObject({ ok: true, warnings: [{ kind: 'truncated', path: '' }] })
  })

  it('reports a lost grant on the vault folder itself', async () => {
    const fs: VaultFs = {
      readDir: async () => ({ entries: [], error: NO_ACCESS }),
      readFileText: async path => ({ error: 'x', message: 'x', ok: false, path })
    }

    expect(await scanVault(fs, '/v', [])).toEqual({ error: NO_ACCESS, ok: false })
  })
})
