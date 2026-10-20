// ESM + CJS builds of src/index.js with peers left external, plus the CSS.
// Plain JS (JSX compiled away) so hosts needn't transpile node_modules.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}dist`
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)

const common = {
  entryPoints: [`${root}src/index.js`],
  bundle: true,
  platform: 'browser',
  target: 'es2019',
  jsx: 'transform',
  loader: { '.js': 'jsx' },
  external: ['react', 'react-dom', 'react-joyride', 'redux-bundler-react'],
  sourcemap: true,
  logLevel: 'info'
}
// Classic runtime: React.createElement, so `react` must be in scope — the
// sources import it explicitly.
await build({ ...common, format: 'esm', outfile: `${dist}/index.mjs` })
await build({ ...common, format: 'cjs', outfile: `${dist}/index.cjs` })
copyFileSync(`${root}src/tour.css`, `${dist}/tour.css`)
