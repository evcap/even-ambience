import { SP } from './glyphs'

// Measured in notes/calibration.md (simulator; re-verify on hardware).
export const GRID_COLS = 28
export const GRID_ROWS = 10

/**
 * A COLS×ROWS buffer of single fullwidth-compatible glyphs.
 * toString() emits exactly ROWS lines with no trailing newline —
 * an 11th row (or trailing \n) clips and summons the firmware scrollbar.
 */
export class Grid {
  readonly cols: number
  readonly rows: number
  private cells: string[][]

  constructor(cols = GRID_COLS, rows = GRID_ROWS) {
    this.cols = cols
    this.rows = rows
    this.cells = Array.from({ length: rows }, () => Array(cols).fill(SP))
  }

  clear(fill = SP): void {
    for (const row of this.cells) row.fill(fill)
  }

  /** Out-of-bounds writes are silently ignored (particles fly off-grid). */
  put(x: number, y: number, ch: string): void {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return
    this.cells[y][x] = ch
  }

  get(x: number, y: number): string {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return SP
    return this.cells[y][x]
  }

  fillRow(y: number, ch: string): void {
    if (y < 0 || y >= this.rows) return
    this.cells[y].fill(ch)
  }

  /** Write a string of cells starting at (x, y), one glyph per cell. */
  write(x: number, y: number, glyphs: string): void {
    let i = 0
    for (const ch of glyphs) this.put(x + i++, y, ch)
  }

  toString(): string {
    return this.cells.map((row) => row.join('')).join('\n')
  }
}
