// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBanner from '../ErrorBanner'

describe('ErrorBanner', () => {
  it('renders the message inside a role=alert landmark with a retry button', () => {
    render(<ErrorBanner message="No se pudo conectar con el servidor" onRetry={() => {}} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('No se pudo conectar con el servidor')
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })

  it('uses the custom retry label when provided', () => {
    render(
      <ErrorBanner message="Sala llena" onRetry={() => {}} retryLabel="VOLVER A INTENTAR" />,
    )
    expect(screen.getByRole('button', { name: /volver a intentar/i })).toBeInTheDocument()
  })

  it('invokes onRetry when the retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorBanner message="Sesión expirada" onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})