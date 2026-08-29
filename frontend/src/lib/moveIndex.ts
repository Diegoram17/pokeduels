export type MoveIndex = 0 | 1 | 2 | 3

/**
 * Wire boundary for move indices: the client model stays 0-based (engine
 * `MoveIndex` 0..3, aligned with `MOVE_SLOTS` / `MOVE_DAMAGE`), but the socket
 * protocol expects 1-based indices (1..4). These two helpers are the only
 * place the conversion happens.
 */
export type WireMoveIndex = 1 | 2 | 3 | 4

export function toWireMoveIndex(i: MoveIndex): WireMoveIndex {
  return (i + 1) as WireMoveIndex
}

export function fromWireMoveIndex(n: number): MoveIndex {
  return (n - 1) as MoveIndex
}