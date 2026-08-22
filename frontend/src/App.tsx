import { Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useMockState } from './state/useMockState'
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
  return (
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
  )
}

export default App