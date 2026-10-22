/**
 * Smoke-tests the SHIPPED file (dist/plugin.js), not the sources: it must evaluate with only the
 * SDK and React external, default-export a plugin, and register + open through the SDK surface.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { host } from '@hermes/plugin-sdk'

import { FakeDisk } from './fake-disk'

type Registered = { area: string; data?: { run?: () => void; defaults?: string[] }; id: string }

let plugin: { id: string; register: (ctx: unknown) => void }

beforeAll(async () => {
  // @ts-expect-error the built file has no types
  plugin = (await import('../dist/plugin.js')).default
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeCtx() {
  const registered: Registered[] = []
  const disposers: (() => void)[] = []
  const data = new Map<string, unknown>()

  return {
    ctx: {
      i18n: { register: () => () => undefined, t: (key: string) => key },
      onDispose: (fn: () => void) => void disposers.push(fn),
      registerMany: (items: Registered[]) => void registered.push(...items),
      registerSettingsPage: vi.fn(),
      storage: {
        get: <T,>(key: string, fallback: T): T => (data.has(key) ? (data.get(key) as T) : fallback),
        remove: (key: string) => void data.delete(key),
        set: (key: string, value: unknown) => void data.set(key, value)
      }
    },
    disposers,
    registered
  }
}

describe('dist/plugin.js', () => {
  it('has the expected identity and nothing but SDK and React as external imports', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('dist/plugin.js', 'utf8')
    const specs = new Set([...source.matchAll(/^import\b[^;]*?from\s*["']([^"']+)["']/gm)].map(m => m[1]))

    expect([...specs].sort()).toEqual(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
    expect(plugin.id).toBe('vault-constellation')
  })

  it('registers a palette command and a keybind, installs styles, and opens one workspace tab', () => {
    const disk = new FakeDisk('C:\\v', { 'A.md': 'a [[B]]', 'B.md': 'b' })

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = disk.bridge

    const open = vi.spyOn(host, 'openWorkspace')
    const { ctx, disposers, registered } = makeCtx()

    plugin.register(ctx)

    expect(registered.map(r => `${r.area}:${r.id}`).sort()).toEqual(['keybinds:open', 'palette:open'])
    expect(registered.find(r => r.area === 'keybinds')?.data?.defaults).toEqual(['mod+shift+g'])
    expect(document.getElementById('vault-constellation-styles')).not.toBeNull()
    expect(ctx.registerSettingsPage).toHaveBeenCalledOnce()

    registered.find(r => r.area === 'palette')!.data!.run!()
    expect(open).toHaveBeenCalledOnce()

    const [id, options] = open.mock.calls[0]!

    expect(id).toBe('vault-constellation')

    // The tab body mounts and asks for a vault folder (none chosen yet).
    render(<>{options.render()}</>)
    expect(screen.getByText('Choose the folder that holds your notes.')).toBeTruthy()

    disposers.forEach(dispose => dispose())
    expect(document.getElementById('vault-constellation-styles')).toBeNull()
  })

  it('does nothing without the Electron file bridge', () => {
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop

    const { ctx, registered } = makeCtx()

    plugin.register(ctx)
    expect(registered).toHaveLength(0)
  })
})
