#!/usr/bin/env node
// Copies the legal/static privacy page (and the few assets it needs) into dist/
// after `vite build`, so Firebase Hosting can serve /privacy.html as a real page
// instead of the single-page app.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const website = fileURLToPath(new URL('../../website/', import.meta.url))
const fail = m => { console.error('copy-hosting-legal: ' + m); process.exit(1) }
if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html is missing: run the Vite build first')

const files = ['privacy.html', 'styles.css', 'site.js', 'favicon.ico', 'icon-96.png', 'icon-192.png']
for (const f of files) {
  const src = join(website, f)
  if (!existsSync(src)) fail('missing ' + src)
  copyFileSync(src, join(dist, f))
}
console.log('copy-hosting-legal: copied privacy page and assets')
