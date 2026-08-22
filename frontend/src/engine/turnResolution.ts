import type { DuelPokemonState, DuelState, MockState } from '../state/schema'
import { computeDamage, type MoveIndex } from './damage'
import { chooseBotMove } from './bot'

export interface TurnResult {
  duelPokemonState: DuelPokemonState[]
  duel: DuelState
}

function clampHp(hp: number): number {
  return Math.max(0, hp)
}

/**
 * Resolves one full turn: the human attacks, then the bot responds if it is
 * still alive. Applies fixed (all-neutral x1) damage, detects KOs, and performs
 * the bot's automatic bench swap when its active pokemon faints.
 *
 * Returns new `duelPokemonState` and `duel` deltas without mutating the input.
 */
export function resolveTurn(humanMoveIndex: MoveIndex, state: MockState): TurnResult {
  const { duel, duelPokemonState, player } = state

  if (!duel || duel.phase === 'finished') {
    return { duelPokemonState, duel }
  }

  const humanOwnerId = player.nickname
  const humanActive = duelPokemonState.find(
    (p) => p.ownerId === humanOwnerId && p.isActive,
  )
  const botActive = duelPokemonState.find(
    (p) => p.ownerId !== humanOwnerId && p.isActive,
  )

  if (!humanActive || !botActive) {
    return { duelPokemonState, duel }
  }

  let pokemon = duelPokemonState.map((p) =>
    p.pokemonId === botActive.pokemonId && p.ownerId === botActive.ownerId
      ? { ...p, currentHp: clampHp(p.currentHp - computeDamage(humanMoveIndex)) }
      : p,
  )

  const botAfter = pokemon.find(
    (p) => p.ownerId === botActive.ownerId && p.pokemonId === botActive.pokemonId,
  )!

  const botFainted = botAfter.currentHp === 0

  if (botFainted) {
    pokemon = pokemon.map((p) =>
      p.ownerId === botActive.ownerId && p.pokemonId === botActive.pokemonId
        ? { ...p, fainted: true, isActive: false }
        : p,
    )
    // Bot's own KO triggers an automatic bench swap inside the engine (no UI,
    // since the bot is not human-driven).
    const botBench = pokemon.find(
      (p) => p.ownerId === botActive.ownerId && !p.isActive && !p.fainted && p.currentHp > 0,
    )
    if (botBench) {
      pokemon = pokemon.map((p) =>
        p.pokemonId === botBench.pokemonId && p.ownerId === botBench.ownerId
          ? { ...p, isActive: true }
          : p,
      )
      return {
        duelPokemonState: pokemon,
        duel: { ...duel, turnNumber: duel.turnNumber + 1 },
      }
    }
    // No bench left: human wins by KO.
    return {
      duelPokemonState: pokemon,
      duel: {
        ...duel,
        turnNumber: duel.turnNumber + 1,
        phase: 'finished',
        winnerId: humanOwnerId,
        endReason: 'ko',
      },
    }
  }

  // Bot is still alive: it responds with a random move.
  const botMove = chooseBotMove()
  pokemon = pokemon.map((p) =>
    p.ownerId === humanActive.ownerId && p.pokemonId === humanActive.pokemonId
      ? { ...p, currentHp: clampHp(p.currentHp - computeDamage(botMove)) }
      : p,
  )

  const humanAfter = pokemon.find(
    (p) => p.ownerId === humanActive.ownerId && p.pokemonId === humanActive.pokemonId,
  )!

  if (humanAfter.currentHp === 0) {
    pokemon = pokemon.map((p) =>
      p.ownerId === humanActive.ownerId && p.pokemonId === humanActive.pokemonId
        ? { ...p, fainted: true, isActive: false }
        : p,
    )
    const humanBench = pokemon.find(
      (p) => p.ownerId === humanActive.ownerId && !p.isActive && !p.fainted && p.currentHp > 0,
    )
    if (!humanBench) {
      return {
        duelPokemonState: pokemon,
        duel: {
          ...duel,
          turnNumber: duel.turnNumber + 1,
          phase: 'finished',
          winnerId: botActive.ownerId,
          endReason: 'ko',
        },
      }
    }
    // Human fainted but has bench: forced swap screen handles navigation.
    return {
      duelPokemonState: pokemon,
      duel: {
        ...duel,
        turnNumber: duel.turnNumber + 1,
        phase: 'awaiting_switch',
        winnerId: null,
        endReason: null,
      },
    }
  }

  return {
    duelPokemonState: pokemon,
    duel: { ...duel, turnNumber: duel.turnNumber + 1 },
  }
}