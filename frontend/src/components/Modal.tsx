import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

export interface ModalProps {
  ariaLabel: string
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  size?: 'sm' | 'lg'
  children: ReactNode
}

/**
 * Shared accessible modal shell (design A4): overlay + pd-card dialog shell +
 * hand-rolled focus trap. Initial focus lands on `initialFocusRef` when
 * provided; Tab/Shift+Tab cycle within the dialog's focusables (never reaching
 * elements behind the modal), Escape acts as `onClose`, and the scoped keydown
 * listener is removed on unmount so it cannot fire for keys pressed afterward.
 *
 * `size` (Fase 7): 'sm' (default) is the original 420px centered dialog;
 * 'lg' widens to 640px and wraps children in the scrollable `.pd-modal-body`
 * so long content (e.g. the Lobby rules text) stays reachable without
 * scrolling the page. Focus-trap behavior is identical for both.
 */
export default function Modal({ ariaLabel, onClose, initialFocusRef, size = 'sm', children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    initialFocusRef?.current?.focus()

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault()
            last.focus()
          }
        } else if (
          document.activeElement === last ||
          !dialogRef.current.contains(document.activeElement)
        ) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [onClose, initialFocusRef])

  const isLg = size === 'lg'

  return (
    <div className="pd-modal-overlay">
      <div
        ref={dialogRef}
        className="pd-card"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          maxWidth: isLg ? 640 : 420,
          width: '100%',
          textAlign: isLg ? 'left' : 'center',
          padding: isLg ? 24 : 32,
        }}
      >
        {isLg ? <div className="pd-modal-body">{children}</div> : children}
      </div>
    </div>
  )
}