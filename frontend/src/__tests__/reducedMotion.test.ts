// @vitest-environment node
/// <reference types="node" />
// UX10 (spec: reduced-motion / WCAG 2.3.3): under `prefers-reduced-motion: reduce`
// no element may run an animation or a non-instant transition. The blanket rule
// `*,*::before,*::after` must replace the old dead-selector list, so the
// `.pd-btn__shine` shimmer stops on every screen that renders it and HP/progress
// fills update instantly.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/pokeduels-design-system.css')
const css = readFileSync(cssPath, 'utf8')

describe('prefers-reduced-motion blanket rule (UX10)', () => {
  it('caps animation duration inside the reduced-motion block', () => {
    expect(css).toContain('animation-duration:.01ms !important')
  })

  it('caps animation iteration count inside the reduced-motion block', () => {
    expect(css).toContain('animation-iteration-count:1 !important')
  })

  it('caps transition duration inside the reduced-motion block', () => {
    expect(css).toContain('transition-duration:.01ms !important')
  })

  it('removes the dead selector list from the reduced-motion block', () => {
    expect(css).not.toContain('.pd-blink,.pd-flicker,.pd-spin')
  })
})