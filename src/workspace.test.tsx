import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDisk } from '../test/fake-disk'
import { PrefsStore } from './prefs'
import { VaultStore } from './store'
import { VaultWorkspace } from './workspace'

const storage = () => {
  const data = new Map<string, unknown>()

  return {
    get: <T,>(key: string, fallback: T): T => (data.has(key) ? (data.get(key) as T) : fallback),
    remove: (key: string) => void data.delete(key),
    set: (key: string, value: unknown) => void data.set(key, value)
  }
}

let disk: FakeDisk
let prefs: PrefsStore
let store: VaultStore

beforeEach(() => {
  disk = new FakeDisk('C:\\v', {
    'Alpha.md': 'alpha links [[Beta]]',
    'Concepts/Beta.md': 'beta',
    'archive/Old.md': 'old'
  })
  prefs = new PrefsStore(storage())
  prefs.useVault('C:\\v')
  store = new VaultStore(disk.bridge, prefs, (key, ...args) => `${key}:${args.join('|')}`)

  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D
  )
  store.start()
})

afterEach(async () => {
  cleanup()
  await store.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const mount = () => render(<VaultWorkspace fs={disk.bridge} prefs={prefs} store={store} />)

describe('VaultWorkspace', () => {
  it('shows the tree and the graph stats, skipping archived notes', async () => {
    mount()

    await screen.findByText('Alpha')
    expect(screen.getAllByText('Concepts').length).toBeGreaterThan(0)
    await screen.findByText('2 notes · 1 links')
    expect(screen.queryByText('Old')).toBeNull()
  })

  it('opens a note into the pane when it is picked in the tree, and saves edits made in the editor', async () => {
    mount()
    fireEvent.click(await screen.findByText('Alpha'))

    await screen.findByRole('tablist')
    await waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    store.edit('Alpha.md', 'edited')
    await store.save('Alpha.md')

    await screen.findByText('Saved')
    expect(disk.text('Alpha.md')).toBe('edited')
  })

  it('shows the conflict banner and lets the user overwrite', async () => {
    mount()
    fireEvent.click(await screen.findByText('Alpha'))
    await waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    store.edit('Alpha.md', 'mine')
    disk.files.set(disk.abs('Alpha.md'), 'theirs')
    await store.save('Alpha.md')

    await screen.findByText('Changed on disk since it was opened')
    fireEvent.click(screen.getByText('Overwrite'))
    await waitFor(() => expect(disk.text('Alpha.md')).toBe('mine'))
  })

  it('keeps web images off until one click on the preview placeholder turns them on', async () => {
    mount()
    await screen.findByText('Alpha')
    disk.files.set(disk.abs('Web.md'), 'a ![pic](https://img.example/p.png)')
    await store.scan('full')

    fireEvent.click(await screen.findByText('Web'))
    await waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))
    fireEvent.click(screen.getByText('Preview'))

    expect(prefs.get().remoteImages).toBe(false)
    expect(screen.queryByRole('img')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: 'Load remote images' }))

    expect(prefs.get().remoteImages).toBe(true)
    expect(((await screen.findByRole('img')) as HTMLImageElement).src).toBe('https://img.example/p.png')
  })

  it('offers to choose the folder again when the vault grant is gone', async () => {
    const pick = vi.fn(async () => null)

    disk.bridge.readDir = async () => ({ entries: [], error: 'no-access' })
    disk.bridge.pickFolder = pick
    prefs.set({ showHidden: true })
    mount()

    await screen.findByText('Hermes no longer has access to this vault folder. Choose it again to grant access.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose vault folder…' })[0]!)
    expect(pick).toHaveBeenCalled()
  })

  it('collapses the note pane to nothing and back via the keyboard-operable divider', async () => {
    mount()
    fireEvent.click(await screen.findByText('Alpha'))

    const divider = await screen.findByRole('separator')

    prefs.set({ noteFrac: 0.04 })
    await waitFor(() => expect(divider.getAttribute('aria-valuenow')).toBe('4'))
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(prefs.get().noteFrac).toBe(0)

    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(prefs.get().noteFrac).toBeGreaterThan(0)
  })

  it('renames through the tree and the open tab follows', async () => {
    mount()
    fireEvent.click(await screen.findByText('Alpha'))
    await waitFor(() => expect(store.get().tabs[0]?.status).toBe('ready'))

    expect((await store.rename('Alpha.md', 'Omega')).ok).toBe(true)

    // Once in the tree, once on the tab.
    await waitFor(() => expect(screen.getAllByText('Omega')).toHaveLength(2))
    expect(store.get().active).toBe('Omega.md')
  })
})
