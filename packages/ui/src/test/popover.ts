const OPEN = 'data-popover-open'

function setOpen(el: HTMLElement, open: boolean) {
  if (el.hasAttribute(OPEN) === open) return
  if (open) el.setAttribute(OPEN, '')
  else el.removeAttribute(OPEN)
  el.dispatchEvent(
    Object.assign(new Event('toggle'), {
      oldState: open ? 'closed' : 'open',
      newState: open ? 'open' : 'closed',
    }),
  )
}

/**
 * jsdom has no Popover API: its default stylesheet hides every `[popover]` (with a selector no
 * author rule outranks, hence the `!important`) and nothing can open one. This gives them the
 * parts HelpTip relies on: `showPopover` / `hidePopover` / `togglePopover`, the `toggle` event,
 * and buttons with `popovertarget` toggling their target on click.
 */
export function stubPopover() {
  if (typeof HTMLElement.prototype.showPopover === 'function') return
  const style = document.createElement('style')
  style.textContent = `[popover][${OPEN}] { display: block !important }`
  document.head.append(style)
  HTMLElement.prototype.showPopover = function showPopover() {
    setOpen(this, true)
  }
  HTMLElement.prototype.hidePopover = function hidePopover() {
    setOpen(this, false)
  }
  HTMLElement.prototype.togglePopover = function togglePopover(force?: boolean) {
    const next = force ?? !this.hasAttribute(OPEN)
    setOpen(this, next)
    return next
  }
  document.addEventListener('click', (event) => {
    const invoker = (event.target as Element | null)?.closest('button[popovertarget]')
    const id = invoker?.getAttribute('popovertarget')
    if (id) document.getElementById(id)?.togglePopover()
  })
}
