// @vitest-environment node
/// <reference types="node" />
// UX3 (spec: document-shell / "Document Locale Attribute"): the entire UI is
// hardcoded Spanish, so lang="en" on the root html element breaks
// screen-reader pronunciation rules. The document shell must declare
// lang="es" and keep no English locale remnant.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const indexHtmlPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html')
const indexHtml = readFileSync(indexHtmlPath, 'utf8')

describe('document shell locale', () => {
  it('declares lang="es" on the root html element', () => {
    expect(indexHtml).toMatch(/<html\s+lang="es">/)
  })

  it('keeps no English locale attribute on the root html element', () => {
    expect(indexHtml).not.toMatch(/<html\s+lang="en">/)
  })
})