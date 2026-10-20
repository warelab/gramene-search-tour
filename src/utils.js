// DOM helpers for tour steps.
//
// Gene search pages typically run an "app shell": at >=992px the navbar and
// footer are position:fixed and the sidebar and results (.search-views-content)
// are SEPARATE overflow-y:auto scroll panes. Joyride's own scrolling assumes the
// window scrolls, so the tour sets `skipScroll` and brings targets into view
// itself with scrollIntoPane() below — which falls back to the window when no
// pane scrolls, so pages without the shell work too.

/** Resolve when `selector` matches a rendered element, or null on timeout. */
export function waitForElement(selector, { timeout = 8000, interval = 100 } = {}) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector)
    if (found) return resolve(found)
    const started = Date.now()
    const tick = setInterval(() => {
      const el = document.querySelector(selector)
      if (el) {
        clearInterval(tick)
        resolve(el)
      } else if (Date.now() - started >= timeout) {
        clearInterval(tick)
        resolve(null)
      }
    }, interval)
  })
}

/** Resolve when `predicate()` is truthy, or on timeout. Returns the value/undefined. */
export function waitFor(predicate, { timeout = 8000, interval = 100 } = {}) {
  return new Promise((resolve) => {
    const first = predicate()
    if (first) return resolve(first)
    const started = Date.now()
    const tick = setInterval(() => {
      const v = predicate()
      if (v) {
        clearInterval(tick)
        resolve(v)
      } else if (Date.now() - started >= timeout) {
        clearInterval(tick)
        resolve(undefined)
      }
    }, interval)
  })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Nearest ancestor that actually scrolls, or null when the window scrolls. */
function scrollableAncestor(el) {
  let node = el.parentElement
  while (node) {
    const oy = window.getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

/** Whether `el` or an ancestor is pinned (sticky or fixed) relative to the window. */
function isPinned(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const pos = window.getComputedStyle(node).position
    if (pos === 'sticky' || pos === 'fixed') return true
  }
  return false
}

/**
 * Height of the header pinned over the top of the window (Bootstrap's
 * .sticky-top / .fixed-top navbar), which a window scroll must clear.
 */
function pinnedHeaderHeight() {
  let bottom = 0
  document.querySelectorAll('.sticky-top, .fixed-top').forEach((h) => {
    const r = h.getBoundingClientRect()
    if (r.top <= 0 && r.bottom > bottom) bottom = r.bottom
  })
  return bottom
}

/**
 * Scroll `target` into view inside its OWN scroll container, leaving every other
 * pane (notably the sidebar) untouched. `block` mimics scrollIntoView: 'start'
 * puts the element at the top of its pane, 'center' centres it.
 *
 * Returns the scroll plan ({container, top}) so callers can wait for it to
 * finish — see settleScroll.
 */
export function scrollIntoPane(target, { block = 'center', margin = 16 } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return null
  const pane = scrollableAncestor(el)
  const elRect = el.getBoundingClientRect()
  if (pane) {
    const paneRect = pane.getBoundingClientRect()
    const offset = elRect.top - paneRect.top + pane.scrollTop
    const raw =
      block === 'center'
        ? offset - Math.max(0, (pane.clientHeight - elRect.height) / 2)
        : offset - margin
    const top = Math.max(0, Math.min(raw, pane.scrollHeight - pane.clientHeight))
    pane.scrollTo({ top, behavior: 'smooth' })
    return { pane, top }
  }
  // A pinned target (Gramene's sticky sidebar) is already on screen; scrolling
  // the window toward it only slides its top under the sticky navbar.
  if (isPinned(el)) return null
  const header = pinnedHeaderHeight()
  const top =
    block === 'center'
      ? Math.max(0, elRect.top + window.scrollY - header -
          Math.max(0, (window.innerHeight - header - elRect.height) / 2))
      : Math.max(0, elRect.top + window.scrollY - header - margin)
  window.scrollTo({ top, behavior: 'smooth' })
  return { pane: null, top }
}

/**
 * Wait for a smooth scroll to actually arrive before letting Joyride measure the
 * target — a fixed delay can't know how far the scroll had to travel, so long
 * jumps would anchor the tooltip mid-flight.
 *
 * Smooth scrolling is animation-driven, so it does not run at all in a
 * background tab (and is skipped under prefers-reduced-motion). If nothing has
 * moved by the deadline, land the scroll instantly rather than give up.
 */
async function settleScroll(plan, { timeout = 1500 } = {}) {
  if (!plan) return
  const read = () => (plan.pane ? plan.pane.scrollTop : window.scrollY)
  const started = Date.now()
  let last = read()
  let stillCount = 0
  while (Date.now() - started < timeout) {
    await sleep(80)
    const now = read()
    if (Math.abs(now - plan.top) <= 2) return // arrived
    if (Math.abs(now - last) < 1) {
      if (++stillCount >= 3) break // not animating
    } else {
      stillCount = 0
    }
    last = now
  }
  if (plan.pane) plan.pane.scrollTop = plan.top
  else window.scrollTo(0, plan.top)
}

/**
 * Ensure a target exists and is positioned, for use inside a step's `before`
 * hook. Accepts a CSS selector, an element, or a function returning one — steps
 * that resolve their target at run time (a specific gene's card, a suggestion
 * button) hand us the element directly. Returns false when the target never
 * appeared, so the caller can let Joyride skip the step.
 */
export async function revealTarget(target, opts = {}) {
  let el = null
  if (typeof target === 'string') {
    el = await waitForElement(target, opts)
  } else if (typeof target === 'function') {
    el = await waitFor(() => target(), opts)
  } else {
    el = target
  }
  if (!el) return false
  await settleScroll(scrollIntoPane(el, opts))
  // extra dwell for targets that reflow after scrolling (ag-grid, tbrowse)
  if (opts.settle) await sleep(opts.settle)
  return true
}

/** Call a redux-bundler action only when the running gramene-search has it. */
export function callIfPresent(fn, ...args) {
  if (typeof fn === 'function') {
    fn(...args)
    return true
  }
  return false
}
