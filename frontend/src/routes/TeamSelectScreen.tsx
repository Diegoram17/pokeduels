import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import { fetchCatalog, filterCatalog, pokemonById, typeOptions, ALL_TYPES, type Pokemon } from '../lib/catalog'
import { describeApiError } from '../lib/api'
import { onSocketEvent } from '../lib/socket'
import { isTeamComplete, toggleRoster, toggleStarter, ROSTER_SIZE } from '../lib/teamSelection'
import ErrorBanner from '../components/ErrorBanner'
import ScreenTopbar from '../components/ScreenTopbar'
import GlowBlob from '../components/GlowBlob'
import HowToPlayModal from '../components/HowToPlayModal'

/**
 * Screen 3: Team Select. Exclusive starter picker (deselect-first), a
 * searchable/type-filtered catalog for the 5 roster picks, and a live team
 * panel backed by mock state (RF-3.1). The catalog is fetched from the
 * backend (GET /api/pokemons) on mount; numeric backend ids are the stored
 * identity while names are resolved for display via catalog lookup.
 */

const TYPE_LABELS: Record<string, string> = {
  normal: 'NORMAL',
  fire: 'FUEGO',
  water: 'AGUA',
  electric: 'ELÉCTRICO',
  grass: 'PLANTA',
  ice: 'HIELO',
  fighting: 'LUCHA',
  poison: 'VENENO',
  ground: 'TIERRA',
  flying: 'VOLADOR',
  psychic: 'PSÍQUICO',
  bug: 'BICHO',
  rock: 'ROCA',
  ghost: 'FANTASMA',
  dragon: 'DRAGÓN',
  dark: 'SINIESTRO',
  steel: 'ACERO',
  fairy: 'HADA',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.toUpperCase()
}

function StarterPicker({
  catalog,
  takenIds,
}: {
  catalog: Pokemon[] | null
  takenIds: number[]
}) {
  const [state, actions] = useMockState()
  const [blockedHint, setBlockedHint] = useState(false)

  const starters = catalog?.filter((pokemon) => pokemon.is_starter) ?? []
  const current = state.teamSelection.starterId

  function handlePick(id: number) {
    const next = toggleStarter(current, id)
    if (next === current && current !== id) {
      setBlockedHint(true)
      return
    }
    setBlockedHint(false)
    actions.updateTeamSelection({ starterId: next })
    // The backend owns starter exclusivity — mirror every accepted pick over WS.
    if (next !== null) {
      actions.selectStarter(next)
    }
  }

  return (
    <section aria-label="ELEGIR INICIAL">
      <h3 className="pd-title section-heading">
        <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--pd-yellow)' }}>
          star
        </span>
        ELEGIR INICIAL
      </h3>
      <div className="starter-grid">
        {starters.map((pokemon) => {
          const selected = current === pokemon.id
          const taken = takenIds.includes(pokemon.id)
          return (
            <button
              type="button"
              key={pokemon.id}
              className={`pd-card pd-card--flush mon-card${selected ? ' mon-card--selected' : ''}${taken ? ' mon-card--taken' : ''}`}
              onClick={() => handlePick(pokemon.id)}
              aria-pressed={selected}
              disabled={catalog === null || taken}
            >
              <div className="art">
                <img src={pokemon.sprite_url} alt="" />
                <span className={`pd-badge pd-badge--${pokemon.type} type-tag`}>
                  {typeLabel(pokemon.type)}
                </span>
                {selected && (
                  <span className="check">
                    <span className="material-symbols-outlined pd-icon--fill" aria-hidden="true">
                      check
                    </span>
                  </span>
                )}
                {taken && (
                  <div className="taken-flag">
                    <span>SELECCIONADO POR RIVAL</span>
                  </div>
                )}
              </div>
              <div className="meta">
                <h4>{pokemon.name}</h4>
                <span>TIPO: {typeLabel(pokemon.type)}</span>
              </div>
            </button>
          )
        })}
      </div>
      {blockedHint && (
        <p role="alert" className="pd-meta" style={{ color: 'var(--pd-yellow-mid)', marginTop: 'var(--pd-space-2)' }}>
          Deselecciona tu inicial actual primero para elegir otra
        </p>
      )}
    </section>
  )
}

function CatalogFilters({
  search,
  onSearch,
  type,
  onType,
  types,
}: {
  search: string
  onSearch: (value: string) => void
  type: string
  onType: (value: string) => void
  types: string[]
}) {
  return (
    <div className="catalog-filters">
      <div className="pd-input-wrap" style={{ flex: 1, minWidth: 180 }}>
        <span className="material-symbols-outlined pd-input-icon" aria-hidden="true">
          search
        </span>
        <input
          type="text"
          className="pd-input pd-input--icon"
          placeholder="Buscar Pokémon..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <div className="pd-field">
        <label htmlFor="type-filter" className="pd-label">
          Tipo
        </label>
        <select
          id="type-filter"
          className="pd-input"
          value={type}
          onChange={(event) => onType(event.target.value)}
          style={{ width: 180 }}
        >
          <option value={ALL_TYPES}>TODOS</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function PokemonCatalogGrid({
  pokemon,
  selectedIds,
  onToggle,
}: {
  pokemon: Pokemon[]
  selectedIds: number[]
  onToggle: (id: number) => void
}) {
  return (
    <div className="catalog-grid">
      {pokemon.map((mon) => {
        const selected = selectedIds.includes(mon.id)
        return (
          <button
            type="button"
            key={mon.id}
            className={`pd-card pd-card--flush catalog-card${selected ? ' mon-card--selected' : ''}`}
            onClick={() => onToggle(mon.id)}
            aria-pressed={selected}
          >
            <div className="art">
              <img src={mon.sprite_url} alt="" />
              <span className={`pd-badge pd-badge--${mon.type} type-tag`}>
                {typeLabel(mon.type)}
              </span>
              {selected && (
                <span className="check">
                  <span className="material-symbols-outlined pd-icon--fill" aria-hidden="true">
                    check
                  </span>
                </span>
              )}
            </div>
            <div className="meta">
              <h4>{mon.name}</h4>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function RosterPicker({
  catalog,
}: {
  catalog: Pokemon[] | null
}) {
  const [state, actions] = useMockState()
  const [search, setSearch] = useState('')
  const [type, setType] = useState(ALL_TYPES)

  // Starters are chosen exclusively in StarterPicker — the catalog grid only
  // offers the remaining roster options.
  const roster = useMemo(() => catalog?.filter((pokemon) => !pokemon.is_starter) ?? [], [catalog])
  const types = useMemo(() => typeOptions(roster), [roster])
  const visible = useMemo(
    () => filterCatalog(roster, search, type),
    [roster, search, type],
  )
  const rosterIds = state.teamSelection.rosterIds

  return (
    <section aria-label="CATÁLOGO">
      <h3 className="pd-title section-heading">
        <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--pd-blue-light)' }}>
          view_cozy
        </span>
        CATÁLOGO
      </h3>
      <CatalogFilters
        search={search}
        onSearch={setSearch}
        type={type}
        onType={setType}
        types={types}
      />
      <PokemonCatalogGrid
        pokemon={visible}
        selectedIds={rosterIds}
        onToggle={(id) => {
          const next = toggleRoster(rosterIds, id)
          actions.updateTeamSelection({ rosterIds: next })
          // Send the full roster over WS once complete (backend validates
          // count=5 and duplicates; rejections surface as an error banner).
          if (next.length === ROSTER_SIZE) {
            actions.selectRoster(next)
          }
        }}
      />
    </section>
  )
}

function TeamPanel({ catalog }: { catalog: Pokemon[] | null }) {
  const [state] = useMockState()
  const navigate = useNavigate()
  const { starterId, rosterIds } = state.teamSelection
  const complete = isTeamComplete(starterId, rosterIds)
  const total = (starterId ? 1 : 0) + rosterIds.length
  const remaining = 6 - total
  const starterName = starterId ? pokemonById(catalog, starterId)?.name ?? String(starterId) : null
  const rosterNames = rosterIds.map((id) => pokemonById(catalog, id)?.name ?? String(id))

  return (
    <aside className="pd-card draft-side" aria-label="TU EQUIPO">
      <div className="draft-side-head">
        <h3 className="pd-title" style={{ letterSpacing: '-.01em' }}>
          TU EQUIPO
        </h3>
        <p className="pd-label" style={{ marginTop: 'var(--pd-space-1)' }}>
          INTEGRANTES (6)
        </p>
      </div>

      <div className="squad-list pd-scroll">
        <div className="squad-slot">
          {starterName ? (
            <>
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 44, color: 'var(--pd-yellow)' }}>
                star
              </span>
              <div>
                <h4>{starterName}</h4>
                <span className="pd-label" style={{ color: 'var(--pd-yellow)', fontSize: 9 }}>
                  INICIAL
                </span>
              </div>
            </>
          ) : (
            <>
              <span>★</span>
              <span className="pd-label">ELIGE TU INICIAL</span>
            </>
          )}
        </div>

        {Array.from({ length: 5 }).map((_, index) => {
          const picked = rosterNames[index]
          return (
            <div key={index} className={`squad-slot${picked ? '' : ' squad-slot--empty'}`}>
              {picked ? (
                <div>
                  <h4>{picked}</h4>
                  <span className="pd-label" style={{ fontSize: 9 }}>
                    MIEMBRO {index + 1}
                  </span>
                </div>
              ) : (
                <>
                  <span className="num">{index + 1}</span>
                  <span className="pd-label">SLOT DISPONIBLE</span>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="draft-side-foot">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--pd-space-2)' }}>
          <span className="pd-stat pd-stat--xl" style={{ color: 'var(--pd-yellow)', display: 'block' }}>
            {total}/6
          </span>
          <span className="pd-meta">SELECCIONADOS</span>
        </div>
        <button
          type="button"
          className="pd-btn pd-btn--primary pd-btn--block"
          disabled={!complete}
          onClick={() => navigate('/wait-room')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {complete ? 'check_circle' : 'lock'}
          </span>
          ¡LISTO PARA COMBATIR!
          <span className="pd-btn__shine" />
        </button>
        <p className="pd-meta" style={{ textAlign: 'center', marginTop: 'var(--pd-space-2)', fontSize: 10 }}>
          {complete ? 'Tu equipo está completo' : `Elige ${remaining} Pokémon más para completar tu equipo`}
        </p>
      </div>
    </aside>
  )
}

function TeamSelectScreen() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<Pokemon[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wsError, setWsError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Starters the backend reported as taken by a rival (team:starter_rejected
  // with reason 'taken') — rendered as .mon-card--taken per Prototipos/3.
  const [takenStarterIds, setTakenStarterIds] = useState<number[]>([])
  const [howToPlayOpen, setHowToPlayOpen] = useState(false)

  const loadCatalog = useCallback(() => {
    setError(null)
    setIsLoading(true)
    fetchCatalog()
      .then(setCatalog)
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  // WS rejection events for team selection route through the same inline
  // error banner + manual retry pattern (decision #3, obs #188/#192). A
  // 'taken' rejection also flags the starter locally so the grid reflects
  // rival picks (re-skin PR4) while keeping the existing banner behavior.
  useEffect(() => {
    const offStarter = onSocketEvent('team:starter_rejected', (payload) => {
      const { pokemonId, reason } = (payload ?? {}) as { pokemonId?: number; reason?: string }
      if (reason === 'taken' && pokemonId != null) {
        setTakenStarterIds((ids) => (ids.includes(pokemonId) ? ids : [...ids, pokemonId]))
      }
      // The pick never landed server-side — roll back the optimistic starterId.
      // Otherwise toggleStarter blocks every other pick while starterId still
      // points at the rejected mon (which is itself disabled as "taken"),
      // deadlocking the picker so the player enters the duel with only 5 mons.
      actions.updateTeamSelection({ starterId: null })
      setWsError('Tu Pokémon inicial fue rechazado. Elegí otro.')
    })
    const offRoster = onSocketEvent('team:roster_rejected', () => {
      setWsError('Tu equipo fue rechazado. Revisá que no haya duplicados.')
    })
    return () => {
      offStarter()
      offRoster()
    }
  }, [actions])

  return (
    <div className="pd-page draft-shell">
      <GlowBlob style={{ left: '-10%', bottom: '-10%', width: 520, height: 520 }} />

      <ScreenTopbar nickname={state.player.nickname}>
        <button
          type="button"
          className="pd-btn pd-btn--ghost"
          onClick={() => setHowToPlayOpen(true)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            help
          </span>
          ¿CÓMO JUGAR?
        </button>
        <button
          type="button"
          className="pd-btn pd-btn--ghost"
          onClick={() => navigate('/lobby')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_back
          </span>
          VOLVER
        </button>
      </ScreenTopbar>

      {howToPlayOpen && <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />}

      <main id="main-content" className="draft-main">
        <div className="draft-left pd-scroll">
          <section className="pd-card draft-heading-card">
            <div>
              <div>
                <h2 className="pd-title pd-title--lg draft-heading" style={{ textTransform: 'uppercase' }}>
                  ELIGE TU EQUIPO
                </h2>
                <p className="pd-body" style={{ marginTop: 'var(--pd-space-1)' }}>
                  Selecciona 1 Pokémon inicial exclusivo y 5 compañeros para tu equipo de combate.
                </p>
              </div>
            </div>
          </section>

          {wsError && <ErrorBanner message={wsError} onRetry={() => setWsError(null)} />}
          {error && <ErrorBanner message={error} onRetry={loadCatalog} />}

          {isLoading && !error ? (
            <>
              <div role="status" aria-label="Cargando iniciales" aria-busy="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="pd-sprite-slot" aria-hidden="true" />
                ))}
              </div>
              <div role="status" aria-label="Cargando catálogo" aria-busy="true">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="pd-sprite-slot" aria-hidden="true" />
                ))}
              </div>
            </>
          ) : !error ? (
            <>
              <StarterPicker catalog={catalog} takenIds={takenStarterIds} />
              <RosterPicker catalog={catalog} />
            </>
          ) : null}
        </div>

        <TeamPanel catalog={catalog} />
      </main>
    </div>
  )
}

export default TeamSelectScreen
export { StarterPicker, RosterPicker, PokemonCatalogGrid, CatalogFilters, TeamPanel }