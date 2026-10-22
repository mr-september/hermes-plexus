import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { linkResolver, parseLinkTarget } from './model'
import { NotePreview, type PreviewContext } from './preview'

afterEach(cleanup)

const notes: Record<string, string> = {
  'A.md': '# A\nsee ![[B#Part]]',
  'B.md': '# B\n## Part\nbody of part\n## Other\nnot this\n![[A]]',
  'Loop.md': '![[Loop]]'
}

function makeCtx(overrides: Partial<PreviewContext> = {}): PreviewContext {
  const resolve = linkResolver(Object.keys(notes))

  return {
    imageUrl: async rel => (rel === 'img/pic.png' ? 'data:image/png;base64,AAAA' : null),
    noteText: async rel => notes[rel] ?? null,
    onFollow: vi.fn(),
    resolveAsset: target => (target.endsWith('pic.png') ? 'img/pic.png' : undefined),
    resolveNote: target => resolve(parseLinkTarget(target).note),
    ...overrides
  }
}

describe('NotePreview', () => {
  it('renders a vault image from its data URL, honouring the requested width', async () => {
    render(<NotePreview ctx={makeCtx()} rel="A.md" text="before ![[pic.png|300]] after" />)

    const img = (await screen.findByRole('img')) as HTMLImageElement

    expect(img.src).toBe('data:image/png;base64,AAAA')
    expect(img.style.width).toBe('300px')
    expect(screen.getAllByTestId('markdown').map(el => el.textContent)).toEqual(['before ', ' after'])
  })

  it('says so when an image cannot be found', async () => {
    render(<NotePreview ctx={makeCtx()} rel="A.md" text="![[gone.jpg]]" />)

    await screen.findByText('Image not found: gone.jpg')
  })

  it('embeds only the named section of another note', async () => {
    render(<NotePreview ctx={makeCtx()} rel="A.md" text={notes['A.md']!} />)

    await screen.findByText('↪ B › Part')
    await waitFor(() => expect(screen.getAllByTestId('markdown').some(el => el.textContent?.includes('body of part'))).toBe(true))
    expect(screen.queryByText(/not this/)).toBeNull()
  })

  it('stops an embed cycle instead of recursing forever', async () => {
    render(<NotePreview ctx={makeCtx()} rel="Loop.md" text={notes['Loop.md']!} />)

    await screen.findByText('Embedded too deeply')
  })

  it('follows a wikilink click, and an embed title click, through the context', async () => {
    const ctx = makeCtx()

    render(<NotePreview ctx={ctx} rel="A.md" text="[x](#vault/Foo%23Bar) ![[B]]" />)
    await screen.findByText('↪ B')

    // The markdown stub renders text only; emulate the rendered anchor Streamdown would produce.
    const link = document.createElement('a')

    link.setAttribute('href', '#vault/Foo%23Bar')
    document.querySelector('.vc-preview')!.appendChild(link)
    fireEvent.click(link)
    expect(ctx.onFollow).toHaveBeenCalledWith('Foo#Bar', 'A.md')

    fireEvent.click(screen.getByText('↪ B'))
    expect(ctx.onFollow).toHaveBeenCalledWith('B.md', 'A.md')
  })
})
