import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockState } from '../state/useMockState'
import { fetchSeedData, type PokemonSeed } from '../data/seedData'
import { filterCatalog, typeOptions, ALL_TYPES } from '../lib/catalog'
import { isTeamComplete, toggleRoster, toggleStarter } from '../lib/teamSelection'

/**
 * Screen 3: Team Select. Exclusive starter picker (deselect-first), a
 * searchable/type-filtered catalog for the 5 roster picks, and a live team
 * panel backed by mock state (RF-3.1).
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

function StarterPicker() {
  const [state, actions] = useMockState()
  const [blockedHint, setBlockedHint] = useState(false)
  const [starters, setStarters] = useState<PokemonSeed[]>([])

  useEffect(() => {
    let alive = true
    fetchSeedData().then((seed) => {
      if (alive) setStarters(seed.starters)
    })
    return () => {
      alive = false
    }
  }, [])

  const current = state.teamSelection.starterId

  function handlePick(id: string) {
    const next = toggleStarter(current, id)
    if (next === current && current !== id) {
      setBlockedHint(true)
      return
    }
    setBlockedHint(false)
    actions.updateTeamSelection({ starterId: next })
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
          const selected = current === pokemon.name
          const blocked = current !== null && current !== pokemon.name
          return (
            <button
              type="button"
              key={pokemon.name}
              className={`pd-card pd-card--flush mon-card${selected ? ' mon-card--selected' : ''}${blocked ? ' mon-card--taken' : ''}`}
              onClick={() => handlePick(pokemon.name)}
              aria-pressed={selected}
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
    <div style={{ display: 'flex', gap: 'var(--pd-space-3)', flexWrap: 'wrap', marginBottom: 'var(--pd-space-4)' }}>
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
  pokemon: PokemonSeed[]
  selectedIds: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="catalog-grid">
      {pokemon.map((mon) => {
        const selected = selectedIds.includes(mon.name)
        return (
          <button
            type="button"
            key={mon.name}
            className={`pd-card pd-card--flush catalog-card${selected ? ' mon-card--selected' : ''}`}
            onClick={() => onToggle(mon.name)}
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

function RosterPicker() {
  const [state, actions] = useMockState()
  const [search, setSearch] = useState('')
  const [type, setType] = useState(ALL_TYPES)
  const [catalog, setCatalog] = useState<PokemonSeed[]>([])

  useEffect(() => {
    let alive = true
    fetchSeedData().then((seed) => {
      if (alive) setCatalog(seed.catalog)
    })
    return () => {
      alive = false
    }
  }, [])

  const types = useMemo(() => typeOptions(catalog), [catalog])
  const visible = useMemo(
    () => filterCatalog(catalog, search, type),
    [catalog, search, type],
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
        onToggle={(id) => actions.updateTeamSelection({ rosterIds: toggleRoster(rosterIds, id) })}
      />
    </section>
  )
}

function TeamPanel() {
  const [state, actions] = useMockState()
  const navigate = useNavigate()
  const { starterId, rosterIds } = state.teamSelection
  const complete = isTeamComplete(starterId, rosterIds)
  const total = (starterId ? 1 : 0) + rosterIds.length
  const remaining = 6 - total

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
        <div className={`squad-slot${!starterId ? ' squad-slot--empty' : ''}`}>
          {starterId ? (
            <>
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 44, color: 'var(--pd-yellow)' }}>
                star
              </span>
              <div>
                <h4>{starterId}</h4>
                <span className="pd-label" style={{ color: 'var(--pd-yellow)', fontSize: 9 }}>
                  INICIAL
                </span>
              </div>
            </>
          ) : (
            <>
              <span className="num">★</span>
              <span className="pd-label">ELIGE TU INICIAL</span>
            </>
          )}
        </div>

        {Array.from({ length: 5 }).map((_, index) => {
          const picked = rosterIds[index]
          return (
            <div key={index} className={`squad-slot${!picked ? ' squad-slot--empty' : ''}`}>
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
  const [state] = useMockState()
  return (
    <div className="pd-page draft-shell">
      <div className="pd-glow-blob" style={{ left: '-10%', bottom: '-10%', width: 520, height: 520 }} />

      <header className="draft-topbar">
        <div className="draft-profile">
          <span className="avatar-sm">
            <span className="material-symbols-outlined" aria-label="Perfil de Jugador" style={{ fontSize: 16 }}>
              person
            </span>
          </span>
          <span className="pd-meta">{state.player.nickname.toUpperCase() || 'ENTRENADOR'}</span>
        </div>
        <span className="pd-logo pd-logo--sm center-logo">Poke-duels</span>
      </header>

      <div className="draft-main">
        <div className="draft-left pd-scroll">
          <section className="pd-card">
            <div className="draft-progress-head">
              <div>
                <h2 className="pd-title pd-title--lg" style={{ textTransform: 'uppercase' }}>
                  ELIGE TU EQUIPO
                </h2>
                <p className="pd-body" style={{ marginTop: 'var(--pd-space-1)' }}>
                  Selecciona 1 Pokémon inicial exclusivo y 5 compañeros para tu equipo de combate.
                </p>
              </div>
            </div>
          </section>

          <StarterPicker />
          <RosterPicker />
        </div>

        <TeamPanel />
      </div>
    </div>
  )
}

export default TeamSelectScreen
export { StarterPicker, RosterPicker, PokemonCatalogGrid, CatalogFilters, TeamPanel }