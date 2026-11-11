// On a wide window the tab bar used to sit clipped in the bottom-left corner:
// Dayon's light-theme rule sets inset-inline 12px (and this file is imported
// after index.css), so the desktop left:50% + translateX(-50%) never applied
// and the 520px bar was shifted off the left edge.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const dayonCss = readFileSync(resolve(process.cwd(), 'src/dayon.css'), 'utf8')

const desktop = indexCss.split('@media (min-width:1000px)')[1]?.split('@media')[0] || ''
const dayonNoComments = dayonCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('desktop tab bar and overlays stay centered', () => {
  it('resets logical insets and centres #tabbar with margin-inline, including the light theme', () => {
    expect(desktop).toMatch(/:root\[data-theme="light"\]\s+#tabbar/)
    expect(desktop).toMatch(/inset-inline-start:\s*0/)
    expect(desktop).toMatch(/inset-inline-end:\s*0/)
    expect(desktop).toMatch(/margin-inline:\s*auto/)
    expect(desktop).toMatch(/transform:\s*none/)
    // The old centering trick must not come back: with inset-inline still at 12px
    // it was what pushed "Começar" off the left edge.
    const tabRule = desktop.match(/#tabbar,\s*:root\[data-theme="light"\]\s+#tabbar\{([^}]*)\}/)?.[1] || ''
    expect(tabRule).not.toBe('')
    expect(tabRule).not.toMatch(/translateX\(-50%\)/)
    expect(tabRule).toMatch(/width:\s*min\(520px/)
  })

  it('keeps Dayon light-theme side insets on the phone, not on the desktop', () => {
    const blocks = [...dayonNoComments.matchAll(/@media\s*\(max-width:\s*999px\)\s*\{([\s\S]*?)\n\}/g)]
    expect(blocks.length).toBeGreaterThan(0)
    const phone = blocks.map(m => m[1]).join('\n')
    expect(phone).toMatch(/:root\[data-theme="light"\]\s+#tabbar/)
    expect(phone).toMatch(/inset-inline-start:\s*12px/)
    // Outside that query the light-theme bar must not pin itself to the sides.
    const withoutPhoneQueries = dayonNoComments.replace(/@media\s*\(max-width:\s*999px\)\s*\{[\s\S]*?\n\}/g, '')
    const lightBar = withoutPhoneQueries.match(/:root\[data-theme="light"\]\s+#tabbar\{([^}]*)\}/)?.[1] || ''
    expect(lightBar).not.toBe('')
    expect(lightBar).not.toMatch(/inset-inline-start/)
    expect(lightBar).not.toMatch(/inset-inline-end/)
  })

  it('centres the rest timer and sheets the same way', () => {
    expect(desktop).toMatch(/#timer\{[^}]*margin-inline:\s*auto/)
    expect(desktop).toMatch(/body\.no-tabbar\s+#timer\{[^}]*margin-inline:\s*auto/)
    expect(desktop).toMatch(/\.sheet\{[^}]*margin-inline:\s*auto/)
    expect(desktop).not.toMatch(/#timer\{[^}]*margin-left:\s*-260px/)
    expect(desktop).not.toMatch(/\.sheet\{[^}]*margin-left:\s*-320px/)
  })
})
