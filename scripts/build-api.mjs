// Bundles the Express API into api/index.js (the single Vercel function).
// The package is "type": "module", so the bundle is ESM. firebase-admin stays
// external and is installed by Vercel from package.json. The banner gives
// bundled CommonJS dependencies a working require().
import { build } from 'esbuild';
await build({
  entryPoints: ['server/vercel-entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  external: ['firebase-admin', 'firebase-admin/*'],
  legalComments: 'none',
  logLevel: 'info',
});
