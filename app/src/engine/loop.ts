import { EvenAppBridge, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { Grid } from './grid'
import { mulberry32, type Rng } from './rng'
import type { Scene, SceneContext } from '../scenes/types'

// Hardware target (~83 ms/call measured for textContainerUpgrade + margin).
// The simulator runs this effortlessly; do not lower below ~150 without
// re-measuring on real glasses.
export const FRAME_MS = 300

/**
 * Drives one scene: tick → render → textContainerUpgrade, at FRAME_MS pace.
 * Never overlaps bridge calls — if a send is still in flight when the timer
 * fires, that frame is skipped (the classic G2 failure is concurrent sends).
 */
export class FrameLoop {
  private bridge: EvenAppBridge
  private containerID: number
  private containerName: string
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private failStreak = 0
  private ctx: SceneContext
  private scene: Scene | null = null

  /** Drawn over every frame after the scene tick (e.g. the clock). */
  overlay: ((ctx: SceneContext) => void) | null = null

  constructor(bridge: EvenAppBridge, containerID: number, containerName: string, seed = 0xa11b1e) {
    this.bridge = bridge
    this.containerID = containerID
    this.containerName = containerName
    const grid = new Grid()
    const rng: Rng = mulberry32(seed)
    this.ctx = { grid, rng, frame: 0, cols: grid.cols, rows: grid.rows }
  }

  get running(): boolean {
    return this.timer !== null
  }

  start(scene: Scene): void {
    this.stop()
    this.scene = scene
    this.ctx.frame = 0
    this.ctx.grid.clear()
    scene.init(this.ctx)
    void this.renderFrame() // first frame immediately, then steady pace
    this.timer = setInterval(() => void this.renderFrame(), FRAME_MS)
    console.log(`[ambience] scene start: ${scene.id}`)
  }

  /** Pause without losing scene state (background, exit dialog, menu). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Resume the current scene after a stop(). */
  resume(): void {
    if (this.timer === null && this.scene !== null) {
      this.timer = setInterval(() => void this.renderFrame(), FRAME_MS)
    }
  }

  poke(): void {
    if (this.scene?.poke) this.scene.poke(this.ctx)
  }

  private async renderFrame(): Promise<void> {
    if (this.busy || this.scene === null) return // skip, never overlap
    this.busy = true
    try {
      this.ctx.frame++
      this.scene.tick(this.ctx)
      this.overlay?.(this.ctx)
      const ok = await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: this.containerID,
          containerName: this.containerName,
          content: this.ctx.grid.toString(),
        }),
      )
      if (!ok) {
        this.failStreak++
        if (this.failStreak === 1 || this.failStreak % 10 === 0) {
          console.warn(`[ambience] frame send failed (streak ${this.failStreak})`)
        }
        if (this.failStreak >= 30) {
          console.error('[ambience] 30 consecutive send failures — stopping loop')
          this.stop()
        }
      } else {
        this.failStreak = 0
      }
    } catch (err) {
      console.error('[ambience] frame error', err)
    } finally {
      this.busy = false
    }
  }
}
