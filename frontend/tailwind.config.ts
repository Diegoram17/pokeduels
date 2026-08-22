import type { Config } from 'tailwindcss'

// Aliases the --pd-* design tokens (defined in src/assets/pokeduels-design-system.css)
// so Tailwind utilities like `bg-pdRed` or `font-display` can be used alongside the
// existing .pd-* classes. No hex values are duplicated here — the CSS variables
// remain the single source of truth.
export default {
  theme: {
    extend: {
      colors: {
        pdRed: 'var(--pd-red)',
        pdRedLight: 'var(--pd-red-light)',
        pdRedShadow: 'var(--pd-red-shadow)',
        pdRedShadowDeep: 'var(--pd-red-shadow-deep)',
        pdYellow: 'var(--pd-yellow)',
        pdYellowHi: 'var(--pd-yellow-hi)',
        pdYellowMid: 'var(--pd-yellow-mid)',
        pdYellowSoft: 'var(--pd-yellow-soft)',
        pdBlue: 'var(--pd-blue)',
        pdBlueLight: 'var(--pd-blue-light)',
        pdDanger: 'var(--pd-danger)',
        pdBgVoid: 'var(--pd-bg-void)',
        pdBgNavy: 'var(--pd-bg-navy)',
        pdBgNavyDeep: 'var(--pd-bg-navy-deep)',
        pdBgBlack: 'var(--pd-bg-black)',
        pdNavyStroke: 'var(--pd-navy-stroke)',
        pdTextTitle: 'var(--pd-text-title)',
        pdTextBody: 'var(--pd-text-body)',
        pdTextMeta: 'var(--pd-text-meta)',
        pdTextDim: 'var(--pd-text-dim)',
        pdBorderBlue: 'var(--pd-border-blue)',
        pdBorderBlueSoft: 'var(--pd-border-blue-soft)',
        pdBorderBlueDim: 'var(--pd-border-blue-dim)',
        pdHpHighA: 'var(--pd-hp-high-a)',
        pdHpHighB: 'var(--pd-hp-high-b)',
        pdHpMidA: 'var(--pd-hp-mid-a)',
        pdHpMidB: 'var(--pd-hp-mid-b)',
        pdHpLowA: 'var(--pd-hp-low-a)',
        pdHpLowB: 'var(--pd-hp-low-b)',
      },
      fontFamily: {
        display: ['var(--pd-font-display)'],
        mono: ['var(--pd-font-mono)'],
      },
    },
  },
} satisfies Config