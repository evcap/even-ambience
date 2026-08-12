import {
  B2, B3, B4, B5,
  P_FAINT, P_MED, P_STAR, P_FAT,
} from '../engine/glyphs'
import { chance, randInt } from '../engine/rng'
import type { Scene, SceneContext } from './types'

// Snow seen from behind a window (v4 — sill is a glyph bar again):
//   frame  — container borders (continuous pixel lines; glyph verticals
//            are inherently dashed): top/left/right strips + mullion +
//            crossbar, all in main.ts. There is NO bottom border line.
//   sill   — the ▂ bar across row 9 IS the bottom of the window, and the
//            snow builds it up in place: block glyphs are bottom-anchored,
//            so a column's accumulation just raises its block ▂→▃→▄→▅ —
//            snow and sill are one glyph, flush by construction.
//   flakes — depth ramp ◌ (far, slow) → ○ → ＊ → ● (near, fast, rare)
//   melt   — every landed flake melts independently after a uniform random
//            33–70 s lifetime, so the sill's snow depth rises and falls
//            forever
//
// Layout (28×10): rows 0–8 are glass; row 9 = sill + snow depth.
const PILE_ROW = 9
const PANE_LEFT = 0
const PANE_RIGHT = 27

const MAX_FLAKES = 20
const FLAKE_GLYPH = [P_FAINT, P_MED, P_STAR, P_FAT]
const FALL_EVERY = [3, 2, 1, 1] // frames per row of fall, by depth
const DRIFT_SCALE = [0.35, 0.55, 0.8, 1.0] // near flakes feel the wind more

// Sill accumulation: landings-per-column before the sill block grows a
// step (▂ bare → ▃ → ▄ → ▅). Every landed flake melts independently after
// a uniform random lifetime, so snow depth is an equilibrium between
// snowfall and melt — it rises and falls forever instead of saturating.
const SILL_TIERS: Array<[number, string]> = [[16, B5], [10, B4], [5, B3]]
const SILL_BARE = B2
const SILL_CAP = 20
// Per-unit melt lifetime in frames (300 ms each): ~33–70 s uniform.
// LIFE_MAX stretches how long lucky snow lingers; LIFE_MIN is the floor.
const LIFE_MIN = 110
const LIFE_MAX = 233

interface Flake {
  x: number // float; rendered at Math.round
  y: number
  depth: number // 0 far … 3 near/fat
  phase: number // desyncs fall cadence between same-depth flakes
}

export function createSnowfall(): Scene {
  let flakes: Flake[] = []
  let wind = 0
  let windTarget = 0
  let nextWindShift = 0
  let nextGustAt = 0
  // Per-column landed units, stored as their melt frames.
  const sill: number[][] = Array.from({ length: 28 }, () => [])

  function spawn(ctx: SceneContext): void {
    // Mix: ◌ 34% / ○ 26% / ＊ 35% (user-tuned) / ● 5% (rare)
    const r = ctx.rng()
    const depth = r < 0.34 ? 0 : r < 0.6 ? 1 : r < 0.95 ? 2 : 3
    flakes.push({
      x: PANE_LEFT - 0.5 + ctx.rng() * (PANE_RIGHT - PANE_LEFT + 1),
      y: 0,
      depth,
      phase: randInt(ctx.rng, 0, 2),
    })
  }

  function sillGlyph(count: number): string {
    for (const [min, glyph] of SILL_TIERS) if (count >= min) return glyph
    return SILL_BARE
  }

  return {
    id: 'snowfall',
    title: 'Snowfall',

    init(ctx: SceneContext): void {
      flakes = []
      wind = 0
      windTarget = 0
      nextWindShift = 0
      nextGustAt = randInt(ctx.rng, 80, 160)
      for (const col of sill) col.length = 0 // bare sill — building from scratch is the fun
      // Pre-scatter a few flakes so the scene doesn't start empty.
      for (let n = 0; n < 12; n++) {
        spawn(ctx)
        flakes[flakes.length - 1].y = randInt(ctx.rng, 0, 8)
      }
    },

    // Gust: the wind leans hard one way for a while. Fires automatically.
    poke(ctx: SceneContext): void {
      windTarget = (chance(ctx.rng, 0.5) ? 1 : -1) * 1.1
      nextWindShift = ctx.frame + randInt(ctx.rng, 15, 25)
    },

    tick(ctx: SceneContext): void {
      const { grid, rng, frame } = ctx

      if (frame >= nextGustAt) {
        this.poke!(ctx)
        nextGustAt = frame + randInt(rng, 100, 240) // gust every ~30–70 s
      }

      // Wind: ease toward a target that wanders every few seconds.
      if (frame >= nextWindShift) {
        windTarget = (rng() * 2 - 1) * 0.5
        nextWindShift = frame + randInt(rng, 40, 80)
      }
      wind += (windTarget - wind) * 0.1

      for (let n = 0; n < 2; n++) {
        if (flakes.length < MAX_FLAKES && chance(rng, 0.45)) spawn(ctx)
      }

      flakes = flakes.filter((f) => {
        if ((frame + f.phase) % FALL_EVERY[f.depth] !== 0) return true
        f.y += 1
        f.x += wind * DRIFT_SCALE[f.depth] + (rng() * 2 - 1) * 0.3
        const col = Math.round(f.x)
        if (f.x < -0.5 || f.x > 27.5) return false
        if (f.y > PILE_ROW - 1) {
          // A fat ● flake (rare) is a chunk of snow: it guarantees a
          // visible pile where it lands, jumping the column to the first
          // tier at minimum. Ordinary flakes add one landing.
          const gain = f.depth === 3 ? 5 : 1
          for (let n = 0; n < gain && sill[col].length < SILL_CAP; n++) {
            sill[col].push(frame + randInt(rng, LIFE_MIN, LIFE_MAX))
          }
          return false
        }
        return true
      })

      // Melt: each landed unit expires at its own frame; piles thin out
      // layer by layer as their landings age past their lifetimes.
      for (let col = 0; col < 28; col++) {
        if (sill[col].length > 0) sill[col] = sill[col].filter((melts) => melts > frame)
      }

      // ---- render (flakes first; structure overwrites = "behind glass") ----
      grid.clear()

      for (const f of flakes) grid.put(Math.round(f.x), f.y, FLAKE_GLYPH[f.depth])

      // Sill + snow depth in one bottom-anchored block per column (solid —
      // wins over passing flakes). Frame/mullion/crossbar are container
      // borders (main.ts); this row is the window's bottom edge.
      for (let col = PANE_LEFT; col <= PANE_RIGHT; col++) {
        grid.put(col, PILE_ROW, sillGlyph(sill[col].length))
      }
    },
  }
}
