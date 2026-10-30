import './seed'

import { createRoot } from 'react-dom/client'

import { FakeDisk } from '../../test/fake-disk'
import { PrefsStore } from '../../src/prefs'
import { VaultStore } from '../../src/store'
import { installStyles } from '../../src/styles'
import { VaultWorkspace } from '../../src/workspace'
import { translate } from './sdk'
import { syntheticNotes } from '../synthetic'
import demoVault from 'plexus-demo-vault'

const ROOT = 'C:\\demo\\tidal-garden-vault'
const params = new URLSearchParams(location.hash.slice(1))
const scene = params.get('scene') ?? 'graph'

document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark'
installStyles()

// The `nested` scene swaps the demo vault for a generated multi-level one (see demo/synthetic.ts), tuned from the URL hash.
const nestedScene = scene === 'nested'
const num = (key: string, fallback: number) => Number(params.get(key) ?? fallback)

const TOP = ['Projects', 'Research', 'Concepts', 'People', 'Daily', 'Reading']
const SUB = ['Field', 'Lab', 'Models', 'Notes', 'Drafts']

const vault = nestedScene
  ? {
      files: Object.fromEntries(
        syntheticNotes({
          crossFraction: num('cross', 0.1),
          depth: num('depth', 3),
          branching: num('branching', 3),
          folderName: (level, b) => (level === 0 ? TOP[b % TOP.length]! : `${SUB[(level + b) % SUB.length]}${level > 1 ? level : ''}`),
          folderPerNote: params.get('per') === '1',
          links: num('links', 2),
          notes: num('n', 220),
          seed: num('seed', 5),
          skew: num('skew', 0.7)
        }).map(note => [note.rel, note.content])
      ),
      images: {}
    }
  : demoVault

const disk = new FakeDisk(ROOT, vault.files)

for (const [rel, url] of Object.entries(vault.images)) {
  disk.images.set(disk.abs(rel), url)
}

const data = new Map<string, unknown>()

const storage = {
  get: <T,>(key: string, fallback: T): T => (data.has(key) ? (data.get(key) as T) : fallback),
  remove: (key: string) => void data.delete(key),
  set: (key: string, value: unknown) => void data.set(key, value)
}

const prefs = new PrefsStore(storage)

prefs.set({
  cluster: nestedScene ? 'nested' : 'folder',
  noteFrac: scene === 'graph' || nestedScene ? 0.5 : 0.44,
  treeOpen: params.get('tree') !== '0'
})
prefs.useVault(ROOT)

// Pre-seed per-vault view state so the scene starts the way the screenshot needs.
const open: Record<string, string[]> = {
  graph: [],
  local: ['Concepts/Food web.md'],
  note: ['Projects/Tidal Garden.md', 'Research/H1 Predator removal.md'],
  preview: ['Projects/Field Season 2026.md'],
  search: []
}

prefs.saveVault(ROOT, {
  active: open[scene]?.at(-1) ?? null,
  expanded: ['Projects', 'Research', 'Concepts'],
  hiddenInGraph: [],
  nestedPositions: {},
  pinned: [],
  positions: {},
  tabs: open[scene] ?? []
})

const store = new VaultStore(disk.bridge, prefs, translate)

store.start()
createRoot(document.getElementById('root')!).render(<VaultWorkspace fs={disk.bridge} prefs={prefs} store={store} />)

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function until(test: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms

  while (!test() && Date.now() < end) {
    await wait(50)
  }
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector)

async function drive() {
  await until(() => store.get().notes.length > 0 && store.get().tabs.every(tab => tab.status === 'ready'))

  if (scene === 'preview') {
    await until(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Preview'))
    ;[...document.querySelectorAll('button')].find(b => b.textContent === 'Preview')?.click()
    await until(() => document.querySelector('.vc-preview img') !== null)
  }

  if (scene === 'search') {
    const input = q<HTMLInputElement>('input[type="search"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

    set.call(input, '#sensors')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  if (scene === 'local') {
    // Like a user: let the full layout settle first, then switch to the neighbourhood.
    await wait(4500)
    q<HTMLButtonElement>('button[title^="Local graph"]')?.click()
  }

  // Let the force layout settle before the capture.
  await wait(3500)
  document.title = 'ready'
}

void drive()
