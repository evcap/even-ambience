import { createFireplace } from './fireplace'
import { createSnowfall } from './snowfall'
import { createShoreline } from './shoreline'
import { createRain } from './rain'
import { createCandlelight } from './candlelight'
import type { Scene } from './types'

// Scene registry — menu order. Instances are created once; entering a scene
// calls loop.start(), which re-inits it, so no stale state survives.
export const SCENES: Scene[] = [
  createFireplace(),
  createSnowfall(),
  createShoreline(),
  createRain(),
  createCandlelight(),
]
