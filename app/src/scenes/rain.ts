import {
  V_LIGHT, DIAG_UP, DIAG_DOWN,
  P_FAINT, P_MED, P_FAT,
} from '../engine/glyphs'
import { chance, randInt } from '../engine/rng'
import type { Scene, SceneContext } from './types'

// Rain seen from behind a window — same container-border window frame as
// snowfall (main.ts shares the strips). Two layers of water:
//   streaks — rain falling BEHIND the glass: │ heads dropping 2 rows/frame,
//             slanting ╱╲ when the wind leans hard
//   drops   — the fun: a drop hits the PANE (● impact flash), clings as ○
//             for a few seconds, then drips slowly down leaving a fading
//             ◌ trail, until it slides off the bottom at the sill bar.
//             (A pooling water level was tried and removed — a uniform
//             glyph line isn't interesting, and its flat ink can't reach
//             the right border anyway.)
//
// Layout (28×10): all ten rows are glass; the window's bottom edge is the
// filled sill border bar (main.ts), not a glyph row.
const SILL_ROW = 9
const COLS = 28

const MAX_STREAKS = 14
const MAX_DROPS = 6

interface Streak {
  x: number // float; rendered at Math.round
  y: number
}

interface Drop {
  x: number
  y: number
  born: number // frame it hit the pane (impact flash)
  clingUntil: number // frame it starts dripping
  nextStepAt: number
}

interface Trail {
  x: number
  y: number
  until: number
}

export function createRain(): Scene {
  let streaks: Streak[] = []
  let drops: Drop[] = []
  let trails: Trail[] = []
  let wind = 0
  let windTarget = 0
  let nextWindShift = 0
  let squallUntil = 0
  let nextSquallAt = 0

  function spawnDrop(ctx: SceneContext): void {
    drops.push({
      x: randInt(ctx.rng, 0, COLS - 1),
      y: randInt(ctx.rng, 0, 6),
      born: ctx.frame,
      clingUntil: ctx.frame + randInt(ctx.rng, 6, 20), // cling ~2–6 s
      nextStepAt: 0,
    })
  }

  return {
    id: 'rain',
    title: 'Rain',

    init(ctx: SceneContext): void {
      streaks = []
      drops = []
      trails = []
      wind = 0
      windTarget = 0
      nextWindShift = 0
      squallUntil = 0
      nextSquallAt = randInt(ctx.rng, 50, 150)
      // Pre-scatter streaks so the rain is already falling at t=0.
      for (let n = 0; n < 8; n++) {
        streaks.push({ x: ctx.rng() * COLS, y: randInt(ctx.rng, 0, 8) })
      }
    },

    // Squall: heavier rain + hard lean for a few seconds. Fires automatically.
    poke(ctx: SceneContext): void {
      squallUntil = ctx.frame + randInt(ctx.rng, 15, 25)
      windTarget = (chance(ctx.rng, 0.5) ? 1 : -1) * 0.8
      nextWindShift = squallUntil
    },

    tick(ctx: SceneContext): void {
      const { grid, rng, frame } = ctx
      const squall = frame < squallUntil

      if (frame >= nextSquallAt) {
        this.poke!(ctx)
        nextSquallAt = frame + randInt(rng, 50, 150) // every ~15–45 s
      }

      // Wind: ease toward a wandering target (gentler than snow's).
      if (frame >= nextWindShift) {
        windTarget = (rng() * 2 - 1) * 0.3
        nextWindShift = frame + randInt(rng, 40, 80)
      }
      wind += (windTarget - wind) * 0.1

      // ---- streaks (rain behind the glass, fast) ----
      for (let n = 0; n < 3; n++) {
        if (streaks.length < MAX_STREAKS && chance(rng, squall ? 0.85 : 0.5)) {
          streaks.push({ x: rng() * COLS, y: 0 })
        }
      }
      streaks = streaks.filter((s) => {
        s.y += 2 // rain is fast — 2 rows/frame reads as a downpour at 3 fps
        s.x += wind * 0.5
        return s.y <= 8 && s.x > -0.5 && s.x < COLS - 0.5
      })

      // ---- drops on the pane (cling, then drip) ----
      if (drops.length < MAX_DROPS && chance(rng, squall ? 0.25 : 0.12)) {
        spawnDrop(ctx)
      }
      drops = drops.filter((d) => {
        if (frame < d.clingUntil) return true // still clinging
        if (d.nextStepAt === 0) d.nextStepAt = frame // start dripping now
        if (frame >= d.nextStepAt) {
          trails.push({ x: d.x, y: d.y, until: frame + 2 })
          d.y += 1
          if (chance(rng, 0.2)) d.x = Math.max(0, Math.min(COLS - 1, d.x + (chance(rng, 0.5) ? 1 : -1)))
          d.nextStepAt = frame + randInt(rng, 2, 4) // slow, uneven slide
          if (d.y > SILL_ROW) return false // slid off at the sill bar
        }
        return true
      })
      trails = trails.filter((t) => t.until > frame)

      // ---- render (back to front: streaks, trails, drops) ----
      grid.clear()

      const streakGlyph = wind > 0.4 ? DIAG_DOWN : wind < -0.4 ? DIAG_UP : V_LIGHT
      for (const s of streaks) grid.put(Math.round(s.x), s.y, streakGlyph)

      for (const t of trails) grid.put(t.x, t.y, P_FAINT)

      for (const d of drops) {
        // Impact flash ● → clinging ○ (then ◌ trails as it drips). A ◎
        // ripple ring was tried between them and cut — too distracting.
        grid.put(d.x, d.y, frame - d.born < 2 ? P_FAT : P_MED)
      }
    },
  }
}
