import { useEffect, useRef } from 'react'
import type { DuelPokemonState, DuelState } from '../state/schema'
import { getSocket } from '../lib/socket'

/**
 * Hook that automates bot actions during a duel.
 * When it's a bot's turn, automatically selects lead, makes attacks, or switches.
 * Bots are identified by the "🤖" prefix in their nickname (but we use playerId here).
 */
export function useBotAutomation(
  duel: DuelState | null,
  duelPokemonState: DuelPokemonState[],
  botPlayerIds: string[], // Array of bot player IDs in this duel
) {
  const automationTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!duel || duelPokemonState.length === 0 || botPlayerIds.length === 0) {
      return
    }

    const socket = getSocket()
    if (!socket) return

    // Clear any pending automation
    if (automationTimeoutRef.current) {
      clearTimeout(automationTimeoutRef.current)
      automationTimeoutRef.current = null
    }

    // Check each bot
    for (const botId of botPlayerIds) {
      const botPokemon = duelPokemonState.filter(p => p.ownerId === Number(botId))
      const activePokemon = botPokemon.find(p => p.isActive && !p.fainted)
      const hasUnfaintedBench = botPokemon.some(p => !p.fainted && !p.isActive)

      // Lead selection phase
      if (duel.phase === 'lead_selection') {
        const hasActive = botPokemon.some(p => p.isActive)
        if (!hasActive) {
          // Bot needs to select a lead - pick first unfainted pokemon
          const leadCandidate = botPokemon.find(p => !p.fainted)
          if (leadCandidate) {
            automationTimeoutRef.current = window.setTimeout(() => {
              socket.emit('duel:select_lead', {
                duelId: Number(duel.duelId),
                pokemonId: leadCandidate.pokemonId,
              })
            }, 1000 + Math.random() * 1000) // 1-2 second delay for realism
          }
        }
        continue
      }

      // Awaiting actions phase
      if (duel.phase === 'awaiting_actions') {
        if (!activePokemon) {
          // No active pokemon, must switch
          if (hasUnfaintedBench) {
            const switchTarget = botPokemon.find(p => !p.fainted && !p.isActive)
            if (switchTarget) {
              automationTimeoutRef.current = window.setTimeout(() => {
                socket.emit('duel:switch_decision', {
                  duelId: Number(duel.duelId),
                  switchTo: switchTarget.pokemonId,
                })
              }, 1000 + Math.random() * 1000)
            }
          }
          continue
        }

        // Active pokemon exists, make a random attack
        const movesWithPP = [0, 1, 2].filter(moveIndex => {
          const ppKey = `ppMove${moveIndex + 1}` as keyof typeof activePokemon
          return (activePokemon[ppKey] as number) > 0
        })

        if (movesWithPP.length > 0) {
          const randomMoveIndex = movesWithPP[Math.floor(Math.random() * movesWithPP.length)]
          automationTimeoutRef.current = window.setTimeout(() => {
            socket.emit('duel:select_action', {
              duelId: Number(duel.duelId),
              moveIndex: randomMoveIndex + 1, // Backend uses 1-indexed moves
            })
          }, 1500 + Math.random() * 1500) // 1.5-3 second delay for realism
        } else if (hasUnfaintedBench) {
          // No PP left, must switch
          const switchTarget = botPokemon.find(p => !p.fainted && !p.isActive)
          if (switchTarget) {
            automationTimeoutRef.current = window.setTimeout(() => {
              socket.emit('duel:switch_decision', {
                duelId: Number(duel.duelId),
                switchTo: switchTarget.pokemonId,
              })
            }, 1000 + Math.random() * 1000)
          }
        }
        continue
      }

      // Awaiting switch phase (bot needs to switch after KO)
      if (duel.phase === 'awaiting_switch') {
        if (!activePokemon && hasUnfaintedBench) {
          const switchTarget = botPokemon.find(p => !p.fainted && !p.isActive)
          if (switchTarget) {
            automationTimeoutRef.current = window.setTimeout(() => {
              socket.emit('duel:switch_decision', {
                duelId: Number(duel.duelId),
                switchTo: switchTarget.pokemonId,
              })
            }, 1000 + Math.random() * 1000)
          }
        }
        continue
      }
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (automationTimeoutRef.current) {
        clearTimeout(automationTimeoutRef.current)
        automationTimeoutRef.current = null
      }
    }
  }, [duel, duelPokemonState, botPlayerIds])
}
