import type { Grid } from './grid'

// Optional clock overlay: ＨＨ：ＭＭ in fullwidth digits + fullwidth colon
// (U+FF1A), drawn into the top-right 5 cells of row 0 after the scene tick.
// Audited 2026-08-12: renders exactly 5 grid cells (notes/calibration.md).

const FW_ZERO = 0xff10 // '０'
const FW_COLON = '：'

const fw = (d: number) => String.fromCharCode(FW_ZERO + d)

export function clockString(now = new Date()): string {
  const h = now.getHours()
  const m = now.getMinutes()
  return fw(Math.floor(h / 10)) + fw(h % 10) + FW_COLON + fw(Math.floor(m / 10)) + fw(m % 10)
}

/** Overwrites the scene's top-right corner — call after the scene tick. */
export function drawClock(grid: Grid): void {
  grid.write(grid.cols - 5, 0, clockString())
}
