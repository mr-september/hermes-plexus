/**
 * Minimal types for the parts of `@hermes/plugin-sdk` this plugin uses. The real module is supplied
 * by Hermes Desktop at load time (the disk loader rewrites the import to a live shim); in tests a
 * stub stands in. Kept deliberately loose where the app's own types are rich.
 */
declare module '@hermes/plugin-sdk' {
  import type { ReactNode } from 'react'

  export interface PluginStorage {
    get<T>(key: string, fallback: T): T
    remove(key: string): void
    set(key: string, value: unknown): void
  }

  export interface Contribution {
    area: string
    data?: unknown
    id: string
    order?: number
    render?: () => ReactNode
    title?: string
  }

  export interface PluginSettingsPage {
    children?: { id: string; render: () => ReactNode; title: string }[]
    icon?: string
    id: string
    order?: number
    render: () => ReactNode
    title: string
  }

  export interface PluginContext {
    i18n: {
      register: (bundles: Record<string, Record<string, unknown>>) => () => void
      t: (key: string, ...args: unknown[]) => string
    }
    onDispose: (fn: () => void) => void
    registerMany: (contributions: Contribution[]) => () => void
    registerSettingsPage?: (page: PluginSettingsPage) => () => void
    storage: PluginStorage
  }

  export interface HermesPlugin {
    description?: string
    id: string
    name?: string
    register: (ctx: PluginContext) => void
  }

  export interface PaletteContribution {
    id: string
    keywords?: string[]
    label: string
    run: () => void
  }

  export interface KeybindContribution {
    category: string
    defaults: string[]
    id: string
    label: string
    run: () => void
  }

  export const PALETTE_AREA: string
  export const KEYBINDS_AREA: string

  export const host: {
    composer?: {
      insertText: (sessionId: null | string, text: string, options?: { mode?: 'block' | 'inline' | 'prefix' }) => Promise<boolean>
    }
    notify?: (options: { kind?: string; message: string }) => void
    openWorkspace: (
      id: string,
      options: { minWidth?: string; onClose?: () => void; render: () => ReactNode; title?: string }
    ) => () => void
  }

  export function usePluginI18n(pluginId: string): (key: string, ...args: unknown[]) => string

  export function useTheme(): { resolvedMode: 'dark' | 'light'; themeName: string }

  export function useValue<T>(store: { get: () => T; listen: (cb: (value: T) => void) => () => void }): T

  export function Codicon(props: { className?: string; name: string; size?: number | string }): ReactNode

  export function Streamdown(props: { children?: string }): ReactNode
}
