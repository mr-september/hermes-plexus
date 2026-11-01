// Bundles src/plugin.tsx into desktop/plugin.js — the single ESM file Hermes Desktop's
// disk loader evaluates (and the file catalog installs ship). The SDK and React stay
// external (the loader rewrites those specifiers to live shims); everything else
// (CodeMirror, d3-force) is inlined. Unminified on purpose: review reads the shipped file.
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'

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
  plugins: [{
    name: 'omit-codemirror-debug-getter',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]@codemirror[\\/]language[\\/]dist[\\/]index\.js$/ }, ({ path }) => {
        const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
        // @codemirror/language 6.12.4 adds EditorState.tree only as a debugging convenience.
        // Omit the mutation itself: Hermes disallows prototype extensions in desktop plugins.
        // Keep this exact so a dependency update requires review instead of removing arbitrary code.
        const getter = '        if (!EditorState.prototype.hasOwnProperty("tree"))\n'
          + '            Object.defineProperty(EditorState.prototype, "tree", { get() { return syntaxTree(this); } });\n'

        if (source.split(getter).length !== 2) {
          throw new Error('CodeMirror debug getter changed; review the Hermes compatibility transform before building.')
        }

        return { contents: source.replace(getter, ''), loader: 'js' }
      })
    }
  }],
  target: 'es2022'
})

const bad = Object.values(result.metafile.outputs).flatMap(out =>
  out.imports.filter(i => !['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(i.path))
)

if (bad.length) {
  console.error('Unexpected runtime imports in bundle:', bad.map(i => i.path))
  process.exit(1)
}
