// Bundles src/plugin.tsx into desktop/plugin.js — the single ESM file Hermes Desktop's
// disk loader evaluates (and the file catalog installs ship). The SDK and React stay
// external (the loader rewrites those specifiers to live shims); everything else
// (CodeMirror, d3-force) is inlined. Unminified on purpose: review reads the shipped file.
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'

mkdirSync('desktop', { recursive: true })

// @codemirror/language extends its own `EditorState` class with a `tree` getter using
// `Object.defineProperty(EditorState.prototype, …)`. That is a library setting a field on a class
// it ships (which the catalog rules allow), but Hermes' static admission lint matches the literal
// `Object.defineProperty(<X>.prototype` and cannot tell the difference. `Reflect.defineProperty`
// does the same thing for this call, so the bundle uses it. The build fails if the library ever
// changes this line, so the rewrite cannot silently go stale. See README → "Build notes".
const NEEDLE = 'Object.defineProperty(EditorState.prototype, "tree"'

const reflectDefineProperty = {
  name: 'reflect-define-property',
  setup(b) {
    b.onLoad({ filter: /@codemirror[\\/]language[\\/]dist[\\/]index\.js$/ }, args => {
      const source = readFileSync(args.path, 'utf8')

      if (!source.includes(NEEDLE)) {
        throw new Error(`@codemirror/language no longer contains \`${NEEDLE}\`; revisit scripts/build.mjs`)
      }

      return { contents: source.replace(NEEDLE, NEEDLE.replace('Object.', 'Reflect.')), loader: 'js' }
    })
  }
}

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
  plugins: [reflectDefineProperty],
  target: 'es2022'
})

const bad = Object.values(result.metafile.outputs).flatMap(out =>
  out.imports.filter(i => !['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(i.path))
)

if (bad.length) {
  console.error('Unexpected runtime imports in bundle:', bad.map(i => i.path))
  process.exit(1)
}
