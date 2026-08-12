import type { Grid } from '../engine/grid'
import type { Rng } from '../engine/rng'

export interface SceneContext {
  grid: Grid
  rng: Rng
  /** Frame counter since scene init. */
  frame: number
  cols: number
  rows: number
}

export interface Scene {
  id: string
  title: string
  /** Reset internal state; called once before the first tick. */
  init(ctx: SceneContext): void
  /** Advance one frame; mutate ctx.grid into the next picture. */
  tick(ctx: SceneContext): void
  /** Optional click interaction ("poke the scene"). */
  poke?(ctx: SceneContext): void
}
