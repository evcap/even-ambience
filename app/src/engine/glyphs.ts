// Single audit point for every glyph the scenes may place in a grid cell.
// All verified fullwidth-compatible (~20 px cell) in notes/calibration.md.
// ASCII-narrow glyphs (· * and ASCII alphanumerics) are BANNED from grid rows.

export const SP = '　' // U+3000 ideographic space — the empty cell

// Blocks (vertical density ramp, dark → bright)
export const B1 = '▁'
export const B2 = '▂'
export const B3 = '▃'
export const B4 = '▄'
export const B5 = '▅'
export const B6 = '▆'
export const B7 = '▇'
export const B8 = '█'
export const SHADE = '▒'

// Lines / structure
export const H_HEAVY = '━'
export const H_LIGHT = '─'
export const V_HEAVY = '┃'
export const V_LIGHT = '│'
export const H_DOUBLE = '═' // reads as wood grain / plank
export const CROSS_X = '╳' // crossed log ends
export const TOP_EDGE = '▔' // upper-eighth block — floor/mantel line
export const EDGE_L = '▏'
export const EDGE_R = '▕'
export const DIAG_UP = '╱'
export const DIAG_DOWN = '╲'
export const TRI_UP = '▲'
export const CROSS_LINES = '┼' // light cross — window mullion crossing
export const TEE_DOWN = '┬'
export const TEE_RIGHT = '├'
export const TEE_LEFT = '┤'
export const CORNER_SQ_TL = '┌'
export const CORNER_SQ_TR = '┐'

// Particles (depth ramp, faint → fat)
export const P_FAINT = '◌'
export const P_MED = '○'
export const P_STAR = '＊' // fullwidth asterisk
export const P_FAT = '●'

// Misc scene glyphs
export const STAR = '★'
export const STAR_HOLLOW = '☆'
export const DIAMOND_HOLLOW = '◇' // curtain tie-back knot
export const CORNER_TL = '╭'
export const CORNER_TR = '╮'
export const CORNER_BR = '╯'
export const CORNER_BL = '╰'
