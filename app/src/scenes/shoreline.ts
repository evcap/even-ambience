import {
  B1, B2, B3, B4,
  SHADE,
  H_HEAVY, H_LIGHT,
  P_FAINT, P_MED,
} from '../engine/glyphs'
import { chance, randInt } from '../engine/rng'
import type { Scene, SceneContext } from './types'

// Shoreline seen from the beach. This scene is about RHYTHM, not particles:
// a wave-set state machine (build → break → swash → lull, ~5 s per wave at
// 300 ms frames) drives everything — the crest swells up, collapses into
// foam, rushes up the sand as a ragged ▒ edge, then pulls back out.
//
// Layout (28×10, frameless — the sand is its own ground):
//   row 0    sky (open — the clock overlay lives here)
//   row 1    horizon ─ (horizontal glyph lines ARE continuous; only
//            vertical runs dash)
//   rows 2–4 swells: repeating ─━ patterns, phase-advanced at different
//            cadences per row (far = sparse/slow, near = heavy/fast)
//   row 5    crest ▂▃▄ — builds with the wave, collapses on break
//   row 6    foam ○→◌ blooming where the crest broke, drifting, dying
//   row 7    swash: ▒ rushes in, dries through ◌ per column (ragged edge)
//   rows 8–9 sand: static ▁▂ grain (rolled once at init — sand doesn't
//            move; ▒ means foamy WATER in this scene, never ground).
//            When a wave lands, a few foam circles splash onto the sand
//            and fade back out.
const HORIZON_ROW = 1
const CREST_ROW = 5
const FOAM_ROW = 6
const SWASH_ROW = 7
const SAND_ROWS = [8, 9]
const COLS = 28

// Swell bands: pattern[(x + phase) % len], phase ±1 every `every` frames
// (drift direction flips every 5–15 s — tidal back-and-forth).
// Lengths 13/11/9 are coprime to 28 so band seams never line up, and the
// different cadences give parallax shimmer. '' = empty cell.
const SWELLS = [
  { row: 2, every: 4, cells: [H_LIGHT, '', '', H_LIGHT, H_LIGHT, '', H_LIGHT, '', '', '', H_LIGHT, H_LIGHT, ''] },
  { row: 3, every: 3, cells: [H_LIGHT, H_HEAVY, '', H_LIGHT, '', H_LIGHT, H_HEAVY, H_LIGHT, '', H_LIGHT, ''] },
  { row: 4, every: 2, cells: [H_HEAVY, H_HEAVY, H_LIGHT, '', H_HEAVY, H_LIGHT, H_HEAVY, '', H_HEAVY] },
]

type Stage = 'build' | 'break' | 'swash' | 'lull'

const MAX_FOAM = 14

interface Foam {
  x: number // float; rendered at Math.round
  drift: number
  age: number
  life: number
}

interface SandFoam {
  col: number
  rowIdx: number // index into SAND_ROWS
  delay: number // frames before this splash lands (wave crashes row by row)
  age: number
  wet: number // frames of ▒ before decaying through ○ → ◌
  life: number
}

export function createShoreline(): Scene {
  const swellPhase = [0, 0, 0]
  let swellDir = 1
  let nextFlipAt = 0
  const crestH: number[] = Array(COLS).fill(0) // 0..~1.6, eased
  const bias: number[] = Array(COLS).fill(1) // per-wave ragged profile
  const jitter: number[] = Array(COLS).fill(0)
  const wet: number[] = Array(COLS).fill(0) // frames of wetness left
  let foams: Foam[] = []
  let sandFoams: SandFoam[] = []
  // Static sand grain, one glyph per cell of the two sand rows.
  const sand: string[][] = SAND_ROWS.map(() => Array(COLS).fill(B1))

  let stage: Stage = 'lull'
  let stageLeft = 0
  let stageDur = 1
  let amp = 1 // this wave's amplitude
  let setPending = false
  let nextSetAt = 0

  function enter(next: Stage, dur: number): void {
    stage = next
    stageLeft = dur
    stageDur = dur
  }

  function startWave(ctx: SceneContext): void {
    if (setPending || ctx.frame >= nextSetAt) {
      amp = 1.5 // big set wave — full-width ▄ crest, deep swash
      setPending = false
      nextSetAt = ctx.frame + randInt(ctx.rng, 80, 200) // every ~24–60 s
    } else {
      amp = 0.75 + ctx.rng() * 0.4
    }
    // Each wave gets its own ragged profile — without this the crest hits
    // the same glyph tier in every column and reads as a solid wall.
    for (let col = 0; col < COLS; col++) bias[col] = 0.55 + ctx.rng() * 0.75
    enter('build', randInt(ctx.rng, 5, 7))
  }

  /** Crest target height for the current stage (before per-column jitter). */
  function crestTarget(): number {
    switch (stage) {
      case 'build':
        return amp * (1 - stageLeft / stageDur)
      case 'break':
        return amp
      case 'swash':
        return 0.25 * amp
      case 'lull':
        return 0
    }
  }

  return {
    id: 'shoreline',
    title: 'Shoreline',

    init(ctx: SceneContext): void {
      swellPhase[0] = randInt(ctx.rng, 0, 12)
      swellPhase[1] = randInt(ctx.rng, 0, 10)
      swellPhase[2] = randInt(ctx.rng, 0, 8)
      swellDir = 1
      nextFlipAt = randInt(ctx.rng, 17, 50)
      crestH.fill(0)
      jitter.fill(0)
      wet.fill(0)
      foams = []
      sandFoams = []
      for (const row of sand) {
        for (let col = 0; col < COLS; col++) row[col] = chance(ctx.rng, 0.3) ? B2 : B1
      }
      setPending = false
      nextSetAt = randInt(ctx.rng, 60, 140)
      startWave(ctx) // open mid-set so the scene is alive immediately
    },

    // Big set wave: the next wave comes in tall. Fires automatically.
    poke(): void {
      setPending = true
    },

    tick(ctx: SceneContext): void {
      const { grid, rng, frame } = ctx

      // ---- wave-set state machine ----
      if (--stageLeft <= 0) {
        switch (stage) {
          case 'build':
            enter('break', 3)
            break
          case 'break':
            // The wave lands: every column gets a wetness burst (deeper for
            // big waves), giving the swash a ragged, organic leading edge.
            for (let col = 0; col < COLS; col++) {
              wet[col] = Math.max(wet[col], Math.round((4 + rng() * 5) * amp))
            }
            // A few foam splashes hit the sand rows with the wave. Each
            // runs the swash cadence in miniature (▒ → ○ → ◌ → sand), and
            // lands one frame later per row down the beach, so the wave
            // visibly crashes over the shore line by line.
            for (let n = randInt(rng, 4, 7); n > 0; n--) {
              const rowIdx = randInt(rng, 0, SAND_ROWS.length - 1)
              const wetFrames = randInt(rng, 2, 3)
              sandFoams.push({
                col: randInt(rng, 0, COLS - 1),
                rowIdx,
                // Swash row leads; each sand row trails it by one frame.
                // (+2 not +1: the spawn tick itself consumes one delay —
                // decrement and render happen in the same tick.)
                delay: rowIdx + 2,
                age: 0,
                wet: wetFrames,
                life: wetFrames + 4,
              })
            }
            enter('swash', 4)
            break
          case 'swash':
            enter('lull', randInt(rng, 2, 17)) // flat water 0.6 s – 5 s between waves
            break
          case 'lull':
            startWave(ctx)
            break
        }
      }

      // ---- motion layers ----
      if (frame >= nextFlipAt) {
        swellDir = -swellDir
        nextFlipAt = frame + randInt(rng, 17, 50) // flip every ~5–15 s
      }
      for (let i = 0; i < SWELLS.length; i++) {
        if (frame % SWELLS[i].every === 0) swellPhase[i] += swellDir
      }

      // Crest: per-column ease toward the stage target; jitter re-rolled on
      // a slow cadence so the lip stays ragged without strobing.
      const target = crestTarget()
      for (let col = 0; col < COLS; col++) {
        if (frame % 2 === 0) jitter[col] = (rng() * 2 - 1) * 0.15
        crestH[col] += (target * bias[col] + jitter[col] - crestH[col]) * 0.35
      }

      // Foam blooms where the breaking crest stands tall.
      if (stage === 'break') {
        for (let col = 0; col < COLS && foams.length < MAX_FOAM; col++) {
          if (crestH[col] > 0.55 && chance(rng, 0.3)) {
            foams.push({
              x: col + rng() - 0.5,
              drift: (rng() * 2 - 1) * 0.4,
              age: 0,
              life: randInt(rng, 3, 6),
            })
          }
        }
      }
      foams = foams.filter((f) => {
        f.age++
        f.x += f.drift
        return f.age <= f.life && f.x > -0.5 && f.x < COLS - 0.5
      })
      // As each splash sinks in, it rearranges the grain where it hit
      // (and sometimes a neighbouring cell) — waves reshape the sand.
      sandFoams = sandFoams.filter((f) => {
        if (f.delay > 0) {
          f.delay--
          return true
        }
        if (++f.age <= f.life) return true
        const row = sand[f.rowIdx]
        row[f.col] = chance(rng, 0.4) ? B2 : B1
        for (const nb of [f.col - 1, f.col + 1]) {
          if (nb >= 0 && nb < COLS && chance(rng, 0.4)) {
            row[nb] = chance(rng, 0.4) ? B2 : B1
          }
        }
        return false
      })

      // Swash dries out column by column.
      for (let col = 0; col < COLS; col++) {
        if (wet[col] > 0) wet[col]--
      }

      // ---- render ----
      grid.clear()

      for (let col = 0; col < COLS; col++) grid.put(col, HORIZON_ROW, H_LIGHT)

      for (let i = 0; i < SWELLS.length; i++) {
        const { row, cells } = SWELLS[i]
        for (let col = 0; col < COLS; col++) {
          const len = cells.length
          const ch = cells[(((col + swellPhase[i]) % len) + len) % len]
          if (ch !== '') grid.put(col, row, ch)
        }
      }

      for (let col = 0; col < COLS; col++) {
        const h = crestH[col]
        if (h >= 0.75) grid.put(col, CREST_ROW, B4)
        else if (h >= 0.45) grid.put(col, CREST_ROW, B3)
        else if (h >= 0.18) grid.put(col, CREST_ROW, B2)
      }

      for (const f of foams) {
        grid.put(Math.round(f.x), FOAM_ROW, f.age <= f.life / 2 ? P_MED : P_FAINT)
      }

      for (let col = 0; col < COLS; col++) {
        if (wet[col] > 2) grid.put(col, SWASH_ROW, SHADE)
        else if (wet[col] > 0) grid.put(col, SWASH_ROW, P_FAINT)
      }

      for (let i = 0; i < SAND_ROWS.length; i++) {
        for (let col = 0; col < COLS; col++) grid.put(col, SAND_ROWS[i], sand[i][col])
      }
      for (const f of sandFoams) {
        if (f.delay > 0) continue // not landed yet — sand shows through
        const g = f.age <= f.wet ? SHADE : f.age <= f.wet + 2 ? P_MED : P_FAINT
        grid.put(f.col, SAND_ROWS[f.rowIdx], g)
      }
    },
  }
}
