import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useMockState } from './state/useMockState'
import ErrorBanner from './components/ErrorBanner'
import LoginScreen from './routes/LoginScreen'
import LobbyScreen from './routes/LobbyScreen'
import TeamSelectScreen from './routes/TeamSelectScreen'
import WaitRoomScreen from './routes/WaitRoomScreen'
import DuelBoardScreen from './routes/DuelBoardScreen'
import SwapScreen from './routes/SwapScreen'
import RankingScreen from './routes/RankingScreen'

/**
 * Auth guard: routes past the login screen redirect to `/` when the player has
 * not set a nickname yet (prevents dead-end states).
 */
function RequireNickname({ children }: { children: ReactNode }) {
  const [state] = useMockState()
  if (!state.player.nickname) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function App() {
  const navigate = useNavigate()
  const [state, actions] = useMockState()

  // F3 (room:aborted recovery, ADR-0008): the backend tore the room down
  // (e.g. restart), possibly while the player was on any screen. Surface a
  // global recovery banner with a manual "back to lobby" control — no silent
  // auto-redirect (product decision). The player explicitly acknowledges it.
  const recovery = state.roomAborted

  return (
    <>
      {recovery && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            padding: 'var(--pd-space-2) var(--pd-space-3)',
            background: 'rgba(5, 8, 20, 0.92)',
            backdropFilter: 'blur(14px)',
            borderBottom: '1px solid var(--pd-border-blue-dim)',
          }}
        >
          <ErrorBanner
            message={`La sala fue cerrada inesperadamente (${recovery.reason}).`}
            retryLabel="VOLVER AL LOBBY"
            onRetry={() => {
              actions.acknowledgeRoomAborted()
              navigate('/lobby')
            }}
          />
        </div>
      )}
      <Routes>
        <Route path="/" element={<LoginScreen />} />
        <Route
          path="/lobby"
          element={
            <RequireNickname>
              <LobbyScreen />
            </RequireNickname>
          }
        />
        <Route
          path="/team-select"
          element={
            <RequireNickname>
              <TeamSelectScreen />
            </RequireNickname>
          }
        />
        <Route
          path="/wait-room"
          element={
            <RequireNickname>
              <WaitRoomScreen />
            </RequireNickname>
          }
        />
        <Route
          path="/duel"
          element={
            <RequireNickname>
              <DuelBoardScreen />
            </RequireNickname>
          }
        />
        <Route
          path="/swap"
          element={
            <RequireNickname>
              <SwapScreen />
            </RequireNickname>
          }
        />
        <Route
          path="/ranking"
          element={
            <RequireNickname>
              <RankingScreen />
            </RequireNickname>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App