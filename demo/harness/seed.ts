// Deterministic layout for screenshots: the graph seeds node positions from Math.random.
let state = 20261022

Math.random = () => {
  state = (state + 0x6d2b79f5) | 0

  let t = Math.imul(state ^ (state >>> 15), 1 | state)

  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
