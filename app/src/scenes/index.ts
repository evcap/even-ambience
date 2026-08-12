import { createFireplace } from './fireplace'
import { createSnowfall } from './snowfall'
import { createShoreline } from './shoreline'
import type { Scene } from './types'

// Scene registry — menu order. Instances are created once; entering a scene
// calls loop.start(), which re-inits it, so no stale state survives.
export const SCENES: Scene[] = [createFireplace(), createSnowfall(), createShoreline()]
