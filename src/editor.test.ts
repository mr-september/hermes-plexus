import { describe, expect, it } from 'vitest'

import { wikilinkAt } from './editor'

describe('wikilinkAt', () => {
  const line = 'see [[Note#Heading|alias]] and [[Other]] end'

  it('returns the target with its anchor but without the alias, only inside a link', () => {
    expect(wikilinkAt(line, 8)).toBe('Note#Heading')
    expect(wikilinkAt(line, 33)).toBe('Other')
    expect(wikilinkAt(line, 1)).toBeNull()
    expect(wikilinkAt(line, 28)).toBeNull()
  })
})
