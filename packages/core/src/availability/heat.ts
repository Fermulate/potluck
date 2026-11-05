/** Heatmap intensity, 0 (nobody) to 4 (everyone). Matches the 5 step heat scale in the design. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4

/** Level for one cell: 0 when nobody is free, otherwise ceil(count / max * 4), clamped to 1..4. */
export function heatLevel(count: number, max: number): HeatLevel {
  if (!(max > 0) || !(count > 0)) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as HeatLevel
}

/** Levels for a whole grid. `max` is usually the member count. */
export function heatLevels(counts: readonly number[], max: number): HeatLevel[] {
  return counts.map((count) => heatLevel(count, max))
}
