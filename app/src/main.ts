import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { FrameLoop } from './engine/loop'
import { drawClock } from './engine/clock'
import { createFireplace } from './scenes/fireplace'
import { createSnowfall } from './scenes/snowfall'
import { createShoreline } from './scenes/shoreline'

// --- Phase 3/4: engine + fireplace. Menu arrives in Phase 5; for now the app
// boots straight into the scene. Click = clock on/off, double-tap = exit
// dialog. (Scene flares are automatic — no stoke gesture.) ---

const bridge = await waitForEvenAppBridge()

const CONTAINER_ID = 1
const CONTAINER_NAME = 'main'

// `?cal` loads the calibration test card instead of the scene (click = next
// screen). Keep this forever — it's the glyph/grid audit for hardware day.
const CAL_MODE = new URLSearchParams(location.search).has('cal')

let startupCalled = false
let exitDialogPending = false
let lastSysEvent = { type: -1, at: 0 }

const loop = new FrameLoop(bridge, CONTAINER_ID, CONTAINER_NAME)

// Dev scene switch until the Phase 5 menu exists: `?scene=snow` etc.
const SCENE_PARAM = new URLSearchParams(location.search).get('scene')
const scene =
  SCENE_PARAM === 'snow' ? createSnowfall()
  : SCENE_PARAM === 'shore' ? createShoreline()
  : createFireplace()

// Optional clock overlay (top-right, ＨＨ：ＭＭ). Click toggles; persisted.
const CLOCK_KEY = 'clockOn'
let clockOn = false
loop.overlay = (ctx) => {
  if (clockOn) drawClock(ctx.grid)
}

// The snowfall window frame is drawn with container borders, not glyphs:
// text rows have a 6 px inter-line gap (glyphs are 21 px tall on a 27 px
// pitch) so vertical glyph lines are always dashed — container borders are
// continuous pixel lines. The frame is top/left/right strips only — there
// is NO bottom border line: the window's bottom edge is the scene's ▂ sill
// glyph row (y ≈ 262–267), which the snow builds up in place.
const WINDOW_SCENE = scene.id === 'snowfall' && !CAL_MODE

const mainContainer = () =>
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 15,
    paddingLength: 0,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content: '', // first frame arrives via textContainerUpgrade immediately
    isEventCapture: 1,
  })

const strip = (id: number, name: string, x: number, y: number, w: number, h: number, bw = 1) =>
  new TextContainerProperty({
    xPosition: x,
    yPosition: y,
    width: w,
    height: h,
    borderWidth: bw,
    borderColor: 15,
    paddingLength: 0,
    containerID: id,
    containerName: name,
    content: '',
    isEventCapture: 0,
  })

// Window structure. The sill is a FILLED bar (borderWidth 3 on a 6 px-tall
// strip = solid): it spans the full 576 px and meets the side borders
// exactly — the glyph grid's ink is only 28 × 20 = 560 px wide, so a glyph
// sill bar stops 16 px short of the right border. The scene's row-9 snow
// blocks (ink y 262–267, bottom-anchored) overlap the bar and rise above
// it as bumps. Sides run to the bar's bottom; the mullion (centred on the
// glyph grid's 560 px, between cols 13/14) stops at its top; the crossbar
// centres the glass above it.
const windowStrips = () => [
  strip(2, 'mullion', 279, 0, 2, 262),
  strip(3, 'crossbar', 0, 130, 576, 2),
  strip(4, 'top', 0, 0, 576, 2),
  strip(5, 'left', 0, 0, 2, 268),
  strip(6, 'right', 574, 0, 2, 268),
  strip(7, 'sill', 0, 262, 576, 6, 3),
]

async function boot(): Promise<void> {
  if (startupCalled) return
  startupCalled = true // latch on call — createStartUpPageContainer is one-shot

  const textObject = WINDOW_SCENE
    ? [mainContainer(), ...windowStrips()]
    : [mainContainer()]

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: textObject.length,
      textObject,
    }),
  )

  if (result !== 0) {
    console.warn('[ambience] startup returned', result, '— falling back to rebuild')
    const ok = await bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: textObject.length, textObject }),
    )
    if (!ok) {
      console.error('[ambience] rebuild fallback failed too')
      return
    }
  }
  console.log('[ambience] ready')
  if (CAL_MODE) {
    const cal = await import('./calibration')
    calNext = () => void cal.nextScreen(bridge)
    void cal.showScreen(bridge, 0)
  } else {
    try {
      clockOn = (await bridge.getLocalStorage(CLOCK_KEY)) === '1'
    } catch {
      /* no stored value — default off */
    }
    loop.start(scene)
  }
}

let calNext: (() => void) | null = null

/** Duplicate sys events arrive ~50–100 ms apart for one physical transition. */
function isDuplicateSysEvent(type: number): boolean {
  const now = Date.now()
  const dup = lastSysEvent.type === type && now - lastSysEvent.at < 600
  lastSysEvent = { type, at: now }
  return dup
}

bridge.onEvenHubEvent((event) => {
  const eventType = event.textEvent?.eventType ?? event.sysEvent?.eventType
  if (event.textEvent === undefined && event.sysEvent === undefined) return

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined: // SDK normalises CLICK_EVENT (0) to undefined
      if (CAL_MODE) {
        calNext?.()
      } else {
        clockOn = !clockOn // synchronous — the overlay picks it up next frame
        void bridge.setLocalStorage(CLOCK_KEY, clockOn ? '1' : '0')
      }
      break

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Root page (no menu yet): request the system exit dialog. Arm the flag
      // BEFORE the call — the host inverts foreground events around it.
      exitDialogPending = true
      loop.stop()
      void bridge.shutDownPageContainer(1)
      break

    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      if (isDuplicateSysEvent(OsEventTypeList.FOREGROUND_EXIT_EVENT)) break
      if (exitDialogPending) {
        // Inverted polarity: while the dialog is pending, FOREGROUND_EXIT
        // means the user answered "No" — resume, we are NOT backgrounded.
        exitDialogPending = false
        loop.resume()
      } else {
        loop.stop() // genuinely backgrounded
      }
      break

    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      if (isDuplicateSysEvent(OsEventTypeList.FOREGROUND_ENTER_EVENT)) break
      // While the exit dialog is pending this fires as the dialog appears —
      // the page is cleared host-side but we must NOT treat it as foreground.
      if (!exitDialogPending) loop.resume()
      break

    case 7: // SYSTEM_EXIT — user confirmed exit in the dialog
      exitDialogPending = false
      loop.stop()
      break
  }
})

void boot()
