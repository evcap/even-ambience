// Phase 2 calibration test card.
// Click advances through screens; results are read via simulator screenshots
// plus console logs (automation port). Temporary code — replaced by the real
// engine in Phase 3. Findings land in notes/calibration.md.

import {
  EvenAppBridge,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// Fullwidth digit strip, cycling. U+FF10..FF19.
const FW_DIGITS = '０１２３４５６７８９'
const fwRuler = (n: number) => {
  let s = ''
  for (let i = 0; i < n; i++) s += FW_DIGITS[i % 10]
  return s
}
const asciiRuler = (n: number) => {
  let s = ''
  for (let i = 0; i < n; i++) s += String(i % 10)
  return s
}

interface Screen {
  name: string
  content: string
  onEnter?: (bridge: EvenAppBridge) => void
}

// Screen 0 — COLUMNS: one long unwrapped-source line of fullwidth digits
// (wraps at container width → count glyphs on the first rendered line),
// same for ASCII digits.
const cols: Screen = {
  name: 'cols',
  content: `ＣＯＬＳ\n${fwRuler(60)}\n${asciiRuler(100)}`,
}

// Screen 1 — ROWS: numbered lines; count how many are visible.
const rows: Screen = {
  name: 'rows',
  content: Array.from({ length: 16 }, (_, i) => `${FW_DIGITS[Math.floor(i / 10) % 10]}${FW_DIGITS[i % 10]}ＲＯＷ`).join('\n'),
}

// Screen 2 — GLYPH AUDIT: every glyph the scene palettes use, separated by a
// fullwidth Ｘ fiducial. A dropped glyph shows as two adjacent Ｘs.
const glyphs: Screen = {
  name: 'glyphs',
  content: [
    'ＧＬＹＰＨＳ',
    'Ｘ█Ｘ▇Ｘ▆Ｘ▅Ｘ▄Ｘ▃Ｘ▂Ｘ▁Ｘ',
    'Ｘ▒Ｘ━Ｘ─Ｘ┃Ｘ│Ｘ▌Ｘ▐?Ｘ',
    'Ｘ·Ｘ*Ｘ＊Ｘ○Ｘ●Ｘ◎Ｘ◌Ｘ：Ｘ',
    'Ｘ★Ｘ☆Ｘ▲Ｘ△Ｘ▶Ｘ▷Ｘ▼Ｘ▽Ｘ◀Ｘ◁Ｘ',
    'Ｘ╭Ｘ╮Ｘ╯Ｘ╰Ｘ╱Ｘ╲Ｘ┌Ｘ┐Ｘ└Ｘ┘Ｘ',
    'Ｘ♠Ｘ♡Ｘ♥Ｘ♣Ｘ♤Ｘ♧Ｘ◆Ｘ◇Ｘ',
    'Ｘ═Ｘ╳Ｘ▔Ｘ▕Ｘ▏Ｘ┬Ｘ┴Ｘ├Ｘ┤Ｘ┼Ｘ',
    'Ｘ　Ｘ〈end fiducial: gap above = ideographic space ok〉',
  ].join('\n'),
}

// Screen 3 — WIDTH ALIGNMENT: rows of 10 repeated glyphs ending in Ｘ.
// The horizontal position of each trailing Ｘ measures that glyph's width
// relative to the fullwidth reference (row 1). Row 7 tests the 2:1 hypothesis.
const width: Screen = {
  name: 'width',
  content: [
    'ＷＩＤＴＨ',
    '　　　　　　　　　　Ｘ',
    '００００００００００Ｘ',
    '██████████Ｘ',
    '●●●●●●●●●●Ｘ',
    '··········Ｘ',
    '**********Ｘ',
    '████████████████████Ｘ',
    '　　　　　Ｘ',
    '１２：３４Ｘ',
  ].join('\n'),
}

// Screen 4 — CHECKERBOARD: alternating cells; visual grid-coherence check.
const checker: Screen = {
  name: 'checker',
  content: Array.from({ length: 10 }, (_, r) =>
    Array.from({ length: 11 }, (_, c) => ((r + c) % 2 === 0 ? '●' : '　')).join(''),
  ).join('\n'),
}

// Screen 5 — CADENCE: on enter, run batches of textContainerUpgrade at
// several intervals, logging awaited per-call latency. Shows a spinner so
// motion is screenshot-visible.
const SPIN = ['█▁▁▁▁', '▄█▁▁▁', '▁▄█▁▁', '▁▁▄█▁', '▁▁▁▄█', '▁▁▁▁▄']
let cadenceRun = 0
const cadence: Screen = {
  name: 'cadence',
  content: 'ＣＡＤＥＮＣＥ\nrunning…',
  onEnter: (bridge) => {
    const runId = ++cadenceRun
    const intervals = [300, 150, 500]
    const FRAMES = 12
    void (async () => {
      for (const interval of intervals) {
        if (runId !== cadenceRun) return
        const latencies: number[] = []
        for (let f = 0; f < FRAMES; f++) {
          if (runId !== cadenceRun) return
          const t0 = performance.now()
          await bridge.textContainerUpgrade(new TextContainerUpgrade({
            containerID: 1,
            containerName: 'main',
            content: `ＣＡＤＥＮＣＥ ${interval}ms\n${SPIN[f % SPIN.length]}\nframe ${f + 1}/${FRAMES}`,
          }))
          const dt = performance.now() - t0
          latencies.push(dt)
          const wait = interval - dt
          if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        }
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
        console.log(
          `[cal] cadence interval=${interval}ms avg=${avg.toFixed(1)} min=${Math.min(...latencies).toFixed(1)} max=${Math.max(...latencies).toFixed(1)}`,
        )
      }
      if (runId === cadenceRun) console.log('[cal] cadence done')
    })()
  },
}

export const SCREENS: Screen[] = [cols, rows, glyphs, width, checker, cadence]

let current = 0

export function screenContent(i: number): string {
  return SCREENS[i].content
}

export async function showScreen(bridge: EvenAppBridge, i: number): Promise<void> {
  current = ((i % SCREENS.length) + SCREENS.length) % SCREENS.length
  cadenceRun++ // cancel any in-flight cadence batch
  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'main',
    content: SCREENS[current].content,
  }))
  console.log(`[cal] screen ${current} (${SCREENS[current].name})`)
  SCREENS[current].onEnter?.(bridge)
}

export async function nextScreen(bridge: EvenAppBridge): Promise<void> {
  await showScreen(bridge, current + 1)
}
