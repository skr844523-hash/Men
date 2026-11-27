// Bundles the Express API into api/index.js (the single Vercel function).
// firebase-admin stays external and is installed by Vercel from package.json.
import { build } from 'esbuild';
await build({
  entryPoints: ['server/vercel-entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['firebase-admin', 'firebase-admin/*'],
  legalComments: 'none',
  logLevel: 'info',
});
import { appendFileSync } from 'node:fs';
// Vercel's Node runtime expects module.exports to be the request handler.
appendFileSync('api/index.js', '\nmodule.exports = module.exports.default;\n');
