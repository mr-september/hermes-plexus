/** Test stand-in for `@hermes/plugin-sdk`: just the surface this plugin imports. */
import type { ReactNode } from 'react'

import { en } from '../src/i18n'

export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)
}

export const translate = (key: string, ...args: unknown[]): string => {
  const value = lookup(key)

  return typeof value === 'function' ? (value as (...a: unknown[]) => string)(...args) : typeof value === 'string' ? value : key
}

export const usePluginI18n = () => translate

export const host = {
  composer: { insertText: async () => true },
  notify: () => undefined,
  openWorkspace: () => () => undefined
}

export function Codicon({ name }: { name: string; size?: number | string; className?: string }): ReactNode {
  return <i data-codicon={name} />
}

export function Streamdown({ children }: { children?: string }): ReactNode {
  return <div data-testid="markdown">{children}</div>
}

export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
