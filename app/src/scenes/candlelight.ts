import {
  STAR, STAR_HOLLOW, P_STAR, P_FAINT, P_FAT,
  B1, B2, B3, B4, B5, B6, B7, B8,
  TRI_UP, TRI_UP_HOLLOW,
  DIAG_UP, DIAG_DOWN,
} from '../engine/glyphs'
import { chance, randInt } from '../engine/rng'
import type { Scene, SceneContext } from './types'

// A candle burning in front of the night-sky window (window frame =
// container-border strips, shared with snowfall/rain via main.ts).
//
// BEHIND the glass — the starfield. No circles (user rule; the shooting
// star is the one exception):
//   ★ bright  — twinkles by dimming to ☆
//   ☆ hollow / ＊ small — twinkle by blinking off for a frame or two
//   winkers   — transient ＊ that fade in nowhere, hold a few seconds, gone
//   shooting star — rare ● head streaking 3 cols/frame, ╱╲ trail fading ◌
// (A multi-glyph moon was tried and ditched: block ink is bottom-anchored
// so only top limbs can curve, and all ◢◣◤◥ share one slope — every build
// read as blocks or a spaceship, never a disc.)
//
// IN FRONT — the candle (the fun feature): proportions and position rolled
// per candle (1–2 cols wide, 2–5 cells tall, anywhere along the sill). It
// melts VERY slowly — the graded blocks ▁▂▃▄▅▆▇█ give 8 sub-steps per
// cell — and when the wax runs out the room goes dark for a few seconds,
// then a fresh candle appears somewhere else. The flame is as wide as the
// candle — one ▲ per column, each flickering independently (△ gutters,
// ＊ spark pops).
const COLS = 28
const ROWS = 10
const BASE_ROW = 9 // candle stands on the sill bar

// Fixed-star census — sparse is what sells "night".
const TIERS = [
  { count: 3, base: STAR, dim: STAR_HOLLOW },
  { count: 4, base: STAR_HOLLOW, dim: '' },
  { count: 4, base: P_STAR, dim: '' },
]

const MAX_WINKERS = 6
const METEOR_SPEED = 3 // cols/frame; 1 row per 3 cols — a shallow streak

// Wax level → glyph, in eighths of a cell (index 0 unused: 0 wax = no cell).
const WAX = ['', B1, B2, B3, B4, B5, B6, B7, B8]

interface FixedStar {
  x: number
  y: number
  base: string
  dim: string
  dimUntil: number
  nextTwinkleAt: number
}

interface Winker {
  x: number
  y: number
  life: number
}

interface Meteor {
  x: number
  y: number
  dx: 1 | -1
}

interface TrailCell {
  x: number
  y: number
  born: number
  glyph: string
}

export function createCandlelight(): Scene {
  let stars: FixedStar[] = []
  let winkers: Winker[] = []
  let meteor: Meteor | null = null
  let trail: TrailCell[] = []
  let meteorPending = false
  let nextMeteorAt = 0

  // Candle state — all rolled fresh per candle.
  let cx = 0 // left column
  let cw = 1 // width in columns
  let wax = 0 // remaining wax in eighths of a cell
  let meltEvery = 30 // frames per eighth
  let nextMeltAt = 0
  let relightAt = 0 // dark-gap timer once the wax is gone
  let gutterUntil = 0
  let nextGutterAt = 0

  function cellTaken(x: number, y: number): boolean {
    return stars.some((s) => s.x === x && s.y === y)
  }

  function spawnCandle(ctx: SceneContext): void {
    const { rng, frame } = ctx
    cw = chance(rng, 0.55) ? 2 : 1
    cx = randInt(rng, 1, COLS - 1 - cw) // keep off the frame edges
    wax = randInt(rng, 2, 5) * 8 // 2–5 cells tall
    meltEvery = randInt(rng, 15, 30) * cw // wide candles burn slower
    nextMeltAt = frame + meltEvery
    gutterUntil = 0
    nextGutterAt = frame + randInt(rng, 30, 80)
  }

  return {
    id: 'candlelight',
    title: 'Candlelight',

    init(ctx: SceneContext): void {
      stars = []
      winkers = []
      meteor = null
      trail = []
      meteorPending = false
      nextMeteorAt = randInt(ctx.rng, 60, 200)
      spawnCandle(ctx)
      // Scatter the fixed stars with a little personal space (no two within
      // one cell of each other) so the sky never clumps.
      for (const tier of TIERS) {
        for (let n = 0; n < tier.count; n++) {
          for (let attempt = 0; attempt < 40; attempt++) {
            const x = randInt(ctx.rng, 0, COLS - 1)
            const y = randInt(ctx.rng, 0, ROWS - 1)
            const crowded = stars.some(
              (s) => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1,
            )
            if (crowded) continue
            stars.push({
              x, y,
              base: tier.base,
              dim: tier.dim,
              dimUntil: 0,
              nextTwinkleAt: randInt(ctx.rng, 3, 40),
            })
            break
          }
        }
      }
    },

    // Shooting star. Fires automatically (rare); queued if one is mid-flight.
    poke(): void {
      meteorPending = true
    },

    tick(ctx: SceneContext): void {
      const { grid, rng, frame } = ctx

      // ---- twinkles ----
      for (const s of stars) {
        if (frame >= s.nextTwinkleAt) {
          s.dimUntil = frame + randInt(rng, 1, 3)
          s.nextTwinkleAt = frame + randInt(rng, 8, 40) // ~2.5–12 s apart
        }
      }

      // ---- winkers (＊ that wink in and out) ----
      if (winkers.length < MAX_WINKERS && chance(rng, 0.15)) {
        const x = randInt(rng, 0, COLS - 1)
        const y = randInt(rng, 0, ROWS - 1)
        if (!cellTaken(x, y)) {
          winkers.push({ x, y, life: randInt(rng, 6, 16) }) // ~2–5 s
        }
      }
      winkers = winkers.filter((w) => --w.life > 0)

      // ---- candle ----
      if (wax === 0) {
        if (frame >= relightAt) spawnCandle(ctx) // a fresh one, elsewhere
      } else {
        if (frame >= nextMeltAt) {
          wax--
          nextMeltAt = frame + meltEvery
          if (wax === 0) relightAt = frame + randInt(rng, 6, 16) // dark gap
        }
        if (frame >= nextGutterAt) {
          gutterUntil = frame + randInt(rng, 3, 6)
          nextGutterAt = frame + randInt(rng, 30, 80) // gutter every ~10–25 s
        }
      }

      // ---- shooting star ----
      if (!meteor && (meteorPending || frame >= nextMeteorAt)) {
        meteorPending = false
        nextMeteorAt = frame + randInt(rng, 60, 200) // rare: every ~18–60 s
        const dx = chance(rng, 0.5) ? 1 : -1
        meteor = {
          x: dx === 1 ? randInt(rng, 0, 6) : randInt(rng, COLS - 7, COLS - 1),
          y: randInt(rng, 0, 3),
          dx,
        }
      }
      if (meteor) {
        const glyph = meteor.dx === 1 ? DIAG_DOWN : DIAG_UP
        // Advance in per-column substeps so the trail has no gaps.
        for (let step = 0; step < METEOR_SPEED && meteor; step++) {
          trail.push({
            x: Math.round(meteor.x),
            y: Math.round(meteor.y),
            born: frame,
            glyph,
          })
          meteor.x += meteor.dx
          meteor.y += 1 / METEOR_SPEED
          if (meteor.x < 0 || meteor.x >= COLS || meteor.y > ROWS - 1) {
            meteor = null // burned out off-grid
          }
        }
      }
      trail = trail.filter((t) => frame - t.born < 2)

      // ---- render: sky behind the glass, candle in front ----
      grid.clear()

      for (const w of winkers) grid.put(w.x, w.y, P_STAR)

      for (const s of stars) {
        const g = frame < s.dimUntil ? s.dim : s.base
        if (g !== '') grid.put(s.x, s.y, g)
      }

      for (const t of trail) {
        grid.put(t.x, t.y, frame - t.born === 0 ? t.glyph : P_FAINT)
      }
      if (meteor) {
        grid.put(Math.round(meteor.x), Math.round(meteor.y), P_FAT)
      }

      if (wax > 0) {
        // Body: full cells below, graded partial on top (the melt shows).
        const hCells = Math.ceil(wax / 8)
        for (let i = 0; i < hCells; i++) {
          const rem = wax - i * 8
          const g = rem >= 8 ? B8 : WAX[rem]
          for (let c = 0; c < cw; c++) grid.put(cx + c, BASE_ROW - i, g)
        }
        // Flame floats above the wax top — one flame cell per candle
        // column, flickering independently so a wide flame dances.
        const frow = BASE_ROW - hCells
        if (frow >= 0) {
          const guttering = frame < gutterUntil
          for (let c = 0; c < cw; c++) {
            const g = guttering
              ? (frame + c) % 2 === 0 ? TRI_UP_HOLLOW : TRI_UP
              : chance(rng, 0.05) ? P_STAR
              : chance(rng, 0.18) ? TRI_UP_HOLLOW
              : TRI_UP
            grid.put(cx + c, frow, g)
          }
          // Rare spark pop above the flame.
          if (!guttering && frow > 0 && chance(rng, 0.05)) {
            const sx = cx + randInt(rng, 0, cw - 1) + randInt(rng, -1, 1)
            if (sx >= 0 && sx < COLS) grid.put(sx, frow - 1, P_STAR)
          }
        }
      }
    },
  }
}
