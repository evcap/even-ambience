import {
  B4, B6, SHADE, V_LIGHT, DIAG_UP, DIAG_DOWN, CROSS_X,
  P_FAINT, P_FAT, P_MED, P_STAR, SP,
} from '../engine/glyphs'
import { chance, pick, randInt } from '../engine/rng'
import type { Scene, SceneContext } from './types'

// Material vocabulary (v4):
//   flames — no blocks: ▒ body, │ strands, ╱╲ licks, ╳ crackle (≤5%),
//            ◌○ motes, ＊ flashes, △ tips (▲ stoked), lots of air
//   logs   — the only block user: three stacked bars, widening downward
//            (▄ on ▆ on ▆), with slow fire-flicker cells crawling on them
//
// The upper log is NESTED IN the fire: side flame columns reach one row
// lower (down to the upper log's row), so the fire wraps around the log
// instead of sitting on it like a reverse pyramid.
//
// Layout (28×10):
//   row 0      sky (sparks)
//   rows 1..6  flames over the top log (side columns also burn on row 7)
//   row 7      top log (short, centered) with flames flanking it
//   row 8      middle log (wider)
//   row 9      bottom log (full hearth width) — no full-screen floor line
const LOG_TOP_ROW = 7
const LOG_MID_ROW = 8
const LOG_BOT_ROW = 9
const MAX_FLAME = 6

const HEARTH_LEFT = 6
const HEARTH_WIDTH = 16

// Log extents in hearth-relative columns (inclusive). The middle log matches
// the fire's full width on the row above it (the whole hearth); the bottom
// log runs two cells wider on each side (negative = left of the hearth).
const LOG_TOP_START = 4
const LOG_TOP_END = 11
const LOG_MID_START = 0
const LOG_MID_END = 15
const LOG_BOT_START = -2
const LOG_BOT_END = 17

/** Columns over the top log burn down to row 6; flanking columns to row 7. */
function baseRowFor(i: number): number {
  return i >= LOG_TOP_START && i <= LOG_TOP_END ? LOG_TOP_ROW - 1 : LOG_TOP_ROW
}

interface Spark {
  x: number
  y: number
  age: number
}

interface LogFlicker {
  x: number // hearth-relative
  y: number
  glyph: string
}

/** Bell-ish target height profile across the hearth (edges low, middle tall). */
function targetHeight(i: number, scale: number): number {
  const center = (HEARTH_WIDTH - 1) / 2
  const d = Math.abs(i - center) / center
  return Math.max(1, Math.round(MAX_FLAME * (1 - d * d) * scale))
}

/** Frames between glyph re-rolls: smoulder low, dance high. */
function rowCadence(y: number): number {
  if (y >= 6) return 3
  if (y >= 4) return 2
  return 1
}

export function createFireplace(): Scene {
  const heights: number[] = []
  let sparks: Spark[] = []
  let logFlickers: LogFlicker[] = []
  let stokeFrames = 0
  let nextFlareAt = 0
  // Persistent flame-cell buffer [row 0..LOG_TOP_ROW][hearth col].
  const cache: string[][] = []

  function rollFlameCell(ctx: SceneContext, i: number, y: number, h: number, baseRow: number): string {
    const { rng } = ctx
    const center = (HEARTH_WIDTH - 1) / 2
    const centrality = 1 - Math.abs(i - center) / center
    const depth = y - (baseRow - h + 1) // 0 at tip → h-1 at base
    const solidity = (depth / Math.max(1, h - 1)) * 0.55 + centrality * 0.45
    const lean = i < center ? DIAG_UP : DIAG_DOWN

    if (depth === 0) {
      if (chance(rng, 0.3)) return lean
      if (stokeFrames > 0 && chance(rng, 0.2)) return '▲'
      if (chance(rng, 0.2)) return '△'
      if (chance(rng, 0.2)) return P_FAINT
      return chance(rng, 0.5) ? V_LIGHT : SP
    }

    if (!chance(rng, 0.35 + 0.45 * solidity)) return SP

    const r = rng()

    // Bottom row of each column: shimmering bed against the wood.
    if (depth === h - 1 && h >= 2) {
      if (r < 0.5) return SHADE
      if (r < 0.58) return V_LIGHT
      if (r < 0.62) return CROSS_X
      if (r < 0.68) return P_STAR
      if (r < 0.76) return P_FAINT
      return SP
    }

    if (solidity > 0.55) {
      if (r < 0.45) return SHADE
      if (r < 0.57) return V_LIGHT
      if (r < 0.62) return CROSS_X
      if (r < 0.76) return chance(rng, 0.5) ? DIAG_UP : DIAG_DOWN
      if (r < 0.82) return P_FAINT
      if (r < 0.86) return P_STAR
      return SP
    }
    if (r < 0.3) return lean
    if (r < 0.45) return V_LIGHT
    if (r < 0.65) return SHADE
    if (r < 0.78) return P_FAINT
    if (r < 0.81) return P_MED
    return SP
  }

  return {
    id: 'fireplace',
    title: 'Fireplace',

    init(ctx: SceneContext): void {
      heights.length = 0
      sparks = []
      logFlickers = []
      stokeFrames = 0
      for (let i = 0; i < HEARTH_WIDTH; i++) {
        heights.push(Math.max(1, targetHeight(i, 1) - randInt(ctx.rng, 0, 2)))
      }
      cache.length = 0
      for (let y = 0; y <= LOG_TOP_ROW; y++) cache.push(Array(HEARTH_WIDTH).fill(SP))
      nextFlareAt = randInt(ctx.rng, 100, 200)
    },

    // Flare: brief surge + spark burst. Fires automatically every 30–60 s
    // (click is the global clock toggle now — no gesture left for stoking).
    poke(ctx: SceneContext): void {
      stokeFrames = 12
      for (let n = 0; n < 3; n++) {
        const i = randInt(ctx.rng, 3, HEARTH_WIDTH - 4)
        sparks.push({ x: HEARTH_LEFT + i, y: baseRowFor(i) - heights[i], age: 0 })
      }
    },

    tick(ctx: SceneContext): void {
      const { grid, rng, frame } = ctx

      if (frame >= nextFlareAt) {
        this.poke!(ctx)
        nextFlareAt = frame + randInt(rng, 100, 200) // 30–60 s at 300 ms/frame
      }

      const breath = 1 + 0.12 * Math.sin(frame / 14)
      const scale = breath * (stokeFrames > 0 ? 1.35 : 1)
      if (stokeFrames > 0) stokeFrames--

      if (frame % 2 === 0) {
        for (let i = 0; i < HEARTH_WIDTH; i++) {
          const target = targetHeight(i, scale)
          const h = heights[i]
          let step: number
          if (h < target) step = chance(rng, 0.6) ? 1 : 0
          else if (h > target) step = chance(rng, 0.6) ? -1 : 0
          else step = chance(rng, 0.25) ? (chance(rng, 0.5) ? 1 : -1) : 0
          heights[i] = Math.max(1, Math.min(MAX_FLAME, h + step))
        }
      }

      // Slow fire-flicker crawling on the logs: a few cells at a time,
      // refreshed every 4th frame, biased toward the upper logs.
      if (frame % 4 === 0) {
        logFlickers = logFlickers.filter(() => chance(rng, 0.5))
        while (logFlickers.length < 3) {
          const which = rng()
          let y: number, lo: number, hi: number
          if (which < 0.5) { y = LOG_TOP_ROW; lo = LOG_TOP_START; hi = LOG_TOP_END }
          else if (which < 0.85) { y = LOG_MID_ROW; lo = LOG_MID_START; hi = LOG_MID_END }
          else { y = LOG_BOT_ROW; lo = LOG_BOT_START; hi = LOG_BOT_END }
          logFlickers.push({
            x: randInt(rng, lo, hi),
            y,
            // solid ● ember only on the chunky lower logs — it blobs on the thin top bar
            glyph: y === LOG_TOP_ROW
              ? pick(rng, [SHADE, P_FAINT, P_STAR])
              : pick(rng, [SHADE, P_FAINT, P_STAR, P_FAT]),
          })
        }
      }

      // Sparks.
      const spawnP = stokeFrames > 0 ? 0.9 : 0.2
      if (sparks.length < 4 && chance(rng, spawnP)) {
        const i = randInt(rng, 2, HEARTH_WIDTH - 3)
        if (heights[i] >= 2) {
          sparks.push({ x: HEARTH_LEFT + i, y: baseRowFor(i) - heights[i], age: 0 })
        }
      }
      sparks = sparks.filter((s) => {
        s.y -= 1
        s.x += randInt(rng, -1, 1)
        s.age += 1
        return s.age <= 3 && s.y >= 0
      })

      // Flame buffer: per-column base row (side columns wrap the top log).
      for (let i = 0; i < HEARTH_WIDTH; i++) {
        const baseRow = baseRowFor(i)
        const h = Math.min(heights[i], MAX_FLAME)
        const top = baseRow - h + 1
        for (let y = 1; y <= LOG_TOP_ROW; y++) {
          const inShape = y >= top && y <= baseRow
          if (!inShape) {
            cache[y][i] = SP
          } else if (cache[y][i] === SP || frame % rowCadence(y) === 0) {
            cache[y][i] = rollFlameCell(ctx, i, y, h, baseRow)
          }
        }
      }

      // ---- render ----
      grid.clear()

      for (let i = 0; i < HEARTH_WIDTH; i++) {
        for (let y = 1; y <= LOG_TOP_ROW; y++) {
          if (cache[y][i] !== SP) grid.put(HEARTH_LEFT + i, y, cache[y][i])
        }
      }

      // Logs overwrite flame cells on their extents (flames flank, not cover).
      for (let i = LOG_TOP_START; i <= LOG_TOP_END; i++) grid.put(HEARTH_LEFT + i, LOG_TOP_ROW, B4)
      for (let i = LOG_MID_START; i <= LOG_MID_END; i++) grid.put(HEARTH_LEFT + i, LOG_MID_ROW, B6)
      for (let i = LOG_BOT_START; i <= LOG_BOT_END; i++) grid.put(HEARTH_LEFT + i, LOG_BOT_ROW, B6)

      // …except the flicker cells, where fire shows in front of the wood.
      for (const f of logFlickers) grid.put(HEARTH_LEFT + f.x, f.y, f.glyph)

      for (const s of sparks) {
        if (grid.get(s.x, s.y) === SP) grid.put(s.x, s.y, s.age <= 1 ? P_STAR : P_FAINT)
      }
    },
  }
}
