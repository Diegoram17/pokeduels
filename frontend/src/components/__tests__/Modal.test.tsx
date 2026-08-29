// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Modal from '../Modal'

describe('Modal', () => {
  it('renders a dialog with aria-modal and the given aria-label', () => {
    render(
      <Modal ariaLabel="Confirmar rendirse" onClose={vi.fn()}>
        <button type="button">RENDIRSE</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: /confirmar rendirse/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: /rendirse/i })).toBeInTheDocument()
  })

  it('calls onClose exactly once when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal ariaLabel="Confirmar" onClose={onClose}>
        <button type="button">ACEPTAR</button>
      </Modal>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cycles Tab and Shift+Tab between the two focusables, never reaching elements behind the modal', async () => {
    const user = userEvent.setup()
    function TwoButtonModal() {
      const confirmRef = useRef<HTMLButtonElement>(null)
      const cancelRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button type="button">BEHIND-MODAL-ELEMENT</button>
          <Modal ariaLabel="Confirmar" onClose={vi.fn()} initialFocusRef={cancelRef}>
            <button type="button" ref={confirmRef}>
              CONFIRMAR
            </button>
            <button type="button" ref={cancelRef}>
              CANCELAR
            </button>
          </Modal>
        </>
      )
    }
    render(<TwoButtonModal />)
    const confirm = screen.getByRole('button', { name: /confirmar/i })
    const cancel = screen.getByRole('button', { name: /cancelar/i })
    const behind = screen.getByRole('button', { name: /behind-modal-element/i })

    // initialFocusRef lands on the safe action
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    expect(behind).not.toHaveFocus()
  })

  it('detaches the keydown listener on unmount so later keys do not fire', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(
      <Modal ariaLabel="Confirmar" onClose={onClose}>
        <button type="button">ACEPTAR</button>
      </Modal>,
    )
    unmount()
    // Focus a live document element so the press actually bubbles to document —
    // a leaked listener would still fire and fail this test.
    document.body.focus()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})