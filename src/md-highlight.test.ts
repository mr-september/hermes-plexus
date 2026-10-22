import { describe, expect, it } from 'vitest'

import { computeMarks, HIGHLIGHT_LIMIT } from './md-highlight'

const classes = (text: string) => computeMarks(text).map(m => `${m.cls}@${m.from}-${m.to}${m.line ? 'L' : ''}`)

describe('computeMarks', () => {
  it('marks headings, quotes and list markers per line', () => {
    expect(classes('# Title\n> quote\n- item')).toEqual([
      'cm-md-h cm-md-h1@0-0L',
      'cm-md-quote@8-8L',
      'cm-md-list@16-18'
    ])
  })

  it('marks inline code, emphasis, links, wikilinks and tags with correct offsets', () => {
    const text = 'a `c` **b** [[W|x]] [l](u) #t'

    expect(classes(text)).toEqual([
      'cm-md-code@2-5',
      'cm-md-bold@6-11',
      'cm-wikilink@12-19',
      'cm-md-link@20-26',
      'cm-md-tag@27-29'
    ])
  })

  it('does not mark emphasis inside inline code, and treats fenced blocks and frontmatter as blocks', () => {
    expect(classes('`**no**`')).toEqual(['cm-md-code@0-8'])
    expect(classes('```\n# not a heading **x**\n```\n# h')).toEqual([
      'cm-md-codeblock@0-0L',
      'cm-md-codeblock@4-4L',
      'cm-md-codeblock@26-26L',
      'cm-md-h cm-md-h1@30-30L'
    ])
    expect(classes('---\ntags: [a]\n---\nbody')).toEqual(['cm-md-fm@0-0L', 'cm-md-fm@4-4L', 'cm-md-fm@14-14L'])
  })

  it('skips very large documents', () => {
    expect(computeMarks('# x\n'.repeat(HIGHLIGHT_LIMIT))).toEqual([])
  })
})
