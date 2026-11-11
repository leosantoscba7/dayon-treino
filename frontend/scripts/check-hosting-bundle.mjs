#!/usr/bin/env node
// DAYON - Treino: checks the website build (npm run build:hosting) before it may go to Firebase
// Hosting. The exercise stills and animations (catalogue/media, Gym visual) are licensed for the
// app only (NOTICE.md), so the site's dist/ must hold none of them, and the build must be the
// web flavour (no VITE_MOBILE) with the Dayon cloud switched on.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const fail = m => { console.error('check-hosting-bundle: ' + m); process.exit(1) }
if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html is missing: run `npm run build:hosting` first')

const files = []
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
walk(dist)

if (existsSync(join(dist, 'exercise-media'))) fail('dist/exercise-media exists: the licensed exercise media must not go to the website')
const media = files.filter(f => /\.(mp4|webm|gif)$/i.test(f) || (/\.webp$/i.test(f) && /\/\d{4,5}\.webp$/.test(f)))
if (media.length) fail('exercise media in dist/: ' + media.slice(0, 5).map(f => relative(dist, f)).join(', '))
if (/name="opengym-flavor" content="mobile"/.test(readFileSync(join(dist, 'index.html'), 'utf8'))) fail('this is the phone build (VITE_MOBILE=1), not the website')
if (!existsSync(join(dist, 'privacy.html'))) fail('dist/privacy.html is missing: the privacy policy must be a real page on the website')
console.log(`check-hosting-bundle: ok (${files.length} files, no exercise media)`)
