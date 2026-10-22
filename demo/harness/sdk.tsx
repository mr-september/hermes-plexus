/**
 * Browser stand-in for `@hermes/plugin-sdk`, used only by the screenshot harness. It renders the
 * REAL plugin components; only the host app around them (SDK, theme tokens, markdown renderer)
 * is simulated.
 */
import { marked } from 'marked'
import type { ReactNode } from 'react'

import { en } from '../../src/i18n'

export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'

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

export function Codicon({ className, name, size }: { className?: string; name: string; size?: number | string }): ReactNode {
  return <i aria-hidden className={`codicon codicon-${name} ${className ?? ''}`} style={size ? { fontSize: size } : undefined} />
}

export function Streamdown({ children }: { children?: string }): ReactNode {
  return <div dangerouslySetInnerHTML={{ __html: marked.parse(children ?? '', { async: false }) as string }} />
}
