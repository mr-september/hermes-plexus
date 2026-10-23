// Bundles src/plugin.tsx into desktop/plugin.js — the single ESM file Hermes Desktop's
// disk loader evaluates (and the file catalog installs ship). The SDK and React stay
// external (the loader rewrites those specifiers to live shims); everything else
// (CodeMirror, d3-force) is inlined. Unminified on purpose: review reads the shipped file.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('desktop', { recursive: true })

const result = await build({
  bundle: true,
  entryPoints: ['src/plugin.tsx'],
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  format: 'esm',
  jsx: 'automatic',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  outfile: 'desktop/plugin.js',
  platform: 'browser',
  target: 'es2022'
})

const bad = Object.values(result.metafile.outputs).flatMap(out =>
  out.imports.filter(i => !['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(i.path))
)

if (bad.length) {
  console.error('Unexpected runtime imports in bundle:', bad.map(i => i.path))
  process.exit(1)
}
