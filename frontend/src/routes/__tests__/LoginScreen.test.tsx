// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MockStateProvider } from '../../state/MockStateProvider'
import { useMockState } from '../../state/useMockState'
import LoginScreen from '../LoginScreen'

function NicknameProbe() {
  const [state] = useMockState()
  return <div data-testid="nickname-probe">{state.player.nickname}</div>
}

function renderLogin() {
  return render(
    <MockStateProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LoginScreen />} />
          <Route
            path="/lobby"
            element={
              <>
                <div>LOBBY-LANDED</div>
                <NicknameProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MockStateProvider>,
  )
}

describe('LoginScreen', () => {
  it('renders the arena background as a static image', () => {
    renderLogin()
    const img = screen.getByRole('img', { name: /fondo de la arena/i })
    expect(img.getAttribute('src')).toContain('login-bg')
  })

  it('saves a valid trimmed nickname and navigates to the lobby', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), '  Ash  ')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))
    expect(screen.getByTestId('nickname-probe').textContent).toBe('Ash')
    expect(screen.getByText('LOBBY-LANDED')).toBeInTheDocument()
  })

  it('blocks a 2-character nickname with a validation error and no navigation', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByPlaceholderText(/apodo/i), 'Ab')
    await user.click(screen.getByRole('button', { name: /entrar a jugar/i }))
    expect(screen.getByText(/al menos 3 caracteres/i)).toBeInTheDocument()
    expect(screen.queryByText('LOBBY-LANDED')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/apodo/i)).toBeInTheDocument()
  })
})