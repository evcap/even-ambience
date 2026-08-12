import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { FrameLoop } from './engine/loop'
import { drawClock } from './engine/clock'
import { SCENES } from './scenes'

// --- Phase 5: menu root + scenes. Input map (settled 2026-08-12):
//   menu   — swipe: move selection · click: open item · double-tap: exit
//            dialog (the "Exit" item is the preferred route — it minimises
//            exposure to the exit-dialogue wedge trap)
//   scene  — click: clock on/off · swipe up/down: previous/next scene ·
//            double-tap: back to menu
// Event handlers stay synchronous (dispatcher busy-guard drops taps during
// in-flight handlers) — all bridge work is fired void.

const bridge = await waitForEvenAppBridge()

const CONTAINER_ID = 1
const CONTAINER_NAME = 'main'

// `?cal` loads the calibration test card instead of the app (click = next
// screen). Keep this forever — it's the glyph/grid audit for hardware day.
const CAL_MODE = new URLSearchParams(location.search).has('cal')

// Middle dot `·` (Latin-1 safe set) — list items render proportionally, so
// the narrow-glyph ban that applies to grid rows doesn't apply here.
const MENU_ITEMS = [...SCENES.map((s) => `· ${s.title}`), '· Exit']
const EXIT_INDEX = MENU_ITEMS.length - 1

type Mode = 'menu' | 'scene' | 'cal'
let mode: Mode = CAL_MODE ? 'cal' : 'menu'
let sceneIdx = 0
// Mirrored list selection: the simulator (and sometimes hardware for item 0)
// delivers clicks without currentSelectItemIndex — track it ourselves from
// scroll events as the fallback. On hardware, listEvent index/name win.
let menuSel = 0
let startupCalled = false
let exitDialogPending = false
let lastSysEvent = { type: -1, at: 0 }
let lastSwitchAt = 0 // scene-switch swipe debounce

const loop = new FrameLoop(bridge, CONTAINER_ID, CONTAINER_NAME)

// Optional clock overlay (top-right, ＨＨ：ＭＭ). Click toggles; persisted.
const CLOCK_KEY = 'clockOn'
let clockOn = false
loop.overlay = (ctx) => {
  if (clockOn) drawClock(ctx.grid)
}

// ---------------------------------------------------------------- layouts

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

// The window frame (snowfall, rain) is drawn with container borders, not glyphs:
// glyph verticals are inherently dashed (21 px ink on a 27 px pitch), and
// borders are continuous pixel lines. The sill is a FILLED bar (borderWidth
// 3 on a 6 px strip): it spans the full 576 px — a glyph bar can't, the
// glyph grid's ink is only 560 px wide. The scene's row-9 snow blocks
// (ink y 262–267) overlap the bar and rise out of it.
const windowStrips = () => [
  strip(2, 'mullion', 279, 0, 2, 262),
  strip(3, 'crossbar', 0, 130, 576, 2),
  strip(4, 'top', 0, 0, 576, 2),
  strip(5, 'left', 0, 0, 2, 268),
  strip(6, 'right', 574, 0, 2, 268),
  strip(7, 'sill', 0, 262, 576, 6, 3),
]

// Per-scene extra containers (beyond the full-screen main text container).
// Layout is fixed at page build — scene switching rebuilds the page with
// the target scene's container set.
const SCENE_STRIPS: Record<string, () => TextContainerProperty[]> = {
  snowfall: windowStrips,
  rain: windowStrips,
  candlelight: windowStrips,
}

const scenePage = (sceneId: string) => {
  const textObject = [mainContainer(), ...(SCENE_STRIPS[sceneId]?.() ?? [])]
  return { containerTotalNum: textObject.length, textObject }
}

const menuPage = () => ({
  containerTotalNum: 1,
  listObject: [
    new ListContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 1,
      borderColor: 13,
      borderRadius: 6,
      paddingLength: 5,
      containerID: CONTAINER_ID,
      containerName: 'menu',
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: MENU_ITEMS.length,
        itemWidth: 560,
        isItemSelectBorderEn: 1,
        itemName: MENU_ITEMS,
      }),
    }),
  ],
})

// ------------------------------------------------------------- navigation

async function showMenu(): Promise<void> {
  loop.stop()
  mode = 'menu'
  menuSel = 0 // rebuild resets the firmware highlight to the top too
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(menuPage()))
  if (!ok) console.error('[ambience] menu rebuild failed')
}

async function enterScene(idx: number, resume = false): Promise<void> {
  loop.stop()
  mode = 'scene'
  sceneIdx = idx
  const scene = SCENES[idx]
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(scenePage(scene.id)))
  if (!ok) {
    console.error('[ambience] scene rebuild failed:', scene.id)
    return
  }
  if (resume) loop.resume() // same scene, keep its state (foreground return)
  else loop.start(scene)
}

/** Swipe in a scene = previous/next scene, debounced (~300 ms flood guard). */
function switchScene(dir: number): void {
  const now = Date.now()
  if (now - lastSwitchAt < 300) return
  lastSwitchAt = now
  void enterScene((sceneIdx + dir + SCENES.length) % SCENES.length)
}

/** Request the system exit dialog. Arm the flag BEFORE the call — the host
 *  inverts foreground events around it (see page-lifecycle traps). */
function requestExit(): void {
  exitDialogPending = true
  loop.stop()
  void bridge.shutDownPageContainer(1)
}

/** The exit dialog cleared the page host-side; on cancel, put it back. */
function restoreAfterDialogCancel(): void {
  if (mode === 'scene') void enterScene(sceneIdx, true)
  else if (mode === 'menu') void showMenu()
}

// ------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  if (startupCalled) return
  startupCalled = true // latch on call — createStartUpPageContainer is one-shot

  const page = CAL_MODE ? scenePage('cal') : menuPage()
  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))

  if (result !== 0) {
    console.warn('[ambience] startup returned', result, '— falling back to rebuild')
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page))
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

// ---------------------------------------------------------------- events

bridge.onEvenHubEvent((event) => {
  if (event.textEvent === undefined && event.listEvent === undefined && event.sysEvent === undefined) return
  const eventType =
    event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined: // SDK normalises CLICK_EVENT (0) to undefined
      if (mode === 'cal') {
        calNext?.()
      } else if (mode === 'menu') {
        // Hardware listEvent carries the authoritative selection; the
        // simulator's sysEvent clicks don't — fall back to the mirror.
        const li = event.listEvent
        const byName =
          li?.currentSelectItemName !== undefined ? MENU_ITEMS.indexOf(li.currentSelectItemName) : -1
        const idx = li?.currentSelectItemIndex ?? (byName >= 0 ? byName : menuSel)
        if (idx === EXIT_INDEX) requestExit()
        else if (idx >= 0 && idx < SCENES.length) void enterScene(idx)
      } else {
        clockOn = !clockOn // synchronous — the overlay picks it up next frame
        void bridge.setLocalStorage(CLOCK_KEY, clockOn ? '1' : '0')
      }
      break

    case OsEventTypeList.SCROLL_TOP_EVENT: // swipe up
      if (mode === 'menu') menuSel = Math.max(0, menuSel - 1)
      else if (mode === 'scene') switchScene(-1)
      break

    case OsEventTypeList.SCROLL_BOTTOM_EVENT: // swipe down
      if (mode === 'menu') menuSel = Math.min(MENU_ITEMS.length - 1, menuSel + 1)
      else if (mode === 'scene') switchScene(1)
      break

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (mode === 'scene') {
        void showMenu() // non-root double-tap = go back
      } else {
        requestExit() // root (menu/cal) double-tap = system exit dialog
      }
      break

    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      if (isDuplicateSysEvent(OsEventTypeList.FOREGROUND_EXIT_EVENT)) break
      if (exitDialogPending) {
        // Inverted polarity: while the dialog is pending, FOREGROUND_EXIT
        // means the user answered "No" — restore the page, we are NOT
        // backgrounded (the dialog cleared the page host-side).
        exitDialogPending = false
        restoreAfterDialogCancel()
      } else {
        loop.stop() // genuinely backgrounded
      }
      break

    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      if (isDuplicateSysEvent(OsEventTypeList.FOREGROUND_ENTER_EVENT)) break
      // While the exit dialog is pending this fires as the dialog appears —
      // the page is cleared host-side but we must NOT treat it as foreground.
      if (exitDialogPending) break
      // Real foreground return: the host cleared our page — rebuild it.
      if (mode === 'scene') void enterScene(sceneIdx, true)
      else if (mode === 'menu') void showMenu()
      break

    case 7: // SYSTEM_EXIT — user confirmed exit in the dialog
      exitDialogPending = false
      loop.stop()
      break
  }
})

void boot()
