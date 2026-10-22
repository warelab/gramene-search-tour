// Guided tour of a gramene-search gene search interface, built on react-joyride v3.
//
// v3 notes that matter here (its API differs from the v2 examples you'll find
// online): `Joyride` is a NAMED export, defaults live in the `options` prop
// rather than `styles.options`, and each step may carry an async `before` hook
// that the tour awaits (showing a loader) before anchoring. That hook is what
// lets a step switch on a result view, run a search or load an expression study
// and wait for the target to mount — no controlled stepIndex bookkeeping.
//
// We use the `useJoyride` hook rather than the `<Joyride>` component so the tour
// element can be rendered alongside a table of contents that starts it at a
// chosen chapter, and so `controls` is available to the event handler.
//
// This component is the site-independent engine. Each site supplies its own
// `buildSteps(getProps)`; steps that open a chapter carry a `chapter:
// {title, blurb}` field, from which the table of contents is derived. The tour
// is offered from the contents list in the Help / Demo view (rendered there
// through a portal), by any <TourContents/> the site renders itself, by
// startTour(), or by loading the page with ?tour=1 (?tour=N opens at step N).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useJoyride, ACTIONS, EVENTS, STATUS } from 'react-joyride'
import { connect } from 'redux-bundler-react'

const TOUR_PARAM = 'tour'
const START_EVENT = 'gene-search-tour:start'

// Above a fixed navbar (1030) and fixed footer (1031).
const TOUR_Z_INDEX = 2000

const DEFAULT_TOC_INTRO =
  'A guided walk through the search interface. Start at the beginning, or jump ' +
  'to whichever part you need — each chapter sets up the search it needs.'

/**
 * Chapters of a step list, for the table of contents: one entry per step that
 * carries a `chapter` field, with its 0-based step index.
 */
export function chaptersOf(steps) {
  const out = []
  steps.forEach((s, index) => {
    if (s && s.chapter) out.push({ index, title: s.chapter.title, blurb: s.chapter.blurb })
  })
  return out
}

/**
 * Chapters of a site's tour without a running store. Step builders only read
 * props inside their hooks (see createTourKit), so an empty props object is
 * enough to enumerate the steps.
 */
export function tourChapters(buildSteps) {
  return chaptersOf(buildSteps(() => ({})))
}

/**
 * Start a mounted <GeneSearchTour/> from anywhere — a welcome-page card, a help
 * menu item. `fromIndex` is a 0-based step index (a chapter's `index`).
 */
export function startTour(fromIndex = 0) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: { fromIndex } }))
}

/**
 * Table of contents: a list of chapters that starts the tour at a given step.
 * react-joyride has no built-in contents component.
 */
export const TourContents = ({
  chapters,
  onStart = startTour,
  title = 'Take the tour',
  intro = DEFAULT_TOC_INTRO
}) => (
  <div className="gene-search-tour-toc">
    <h4 className="gene-search-tour-toc-title">{title}</h4>
    <p className="gene-search-tour-toc-intro">{intro}</p>
    <ol className="gene-search-tour-toc-list">
      {chapters.map((c) => (
        <li key={c.index}>
          <button type="button" onClick={() => onStart(c.index)}>
            <span className="gene-search-tour-toc-name">{c.title}</span>
            <span className="gene-search-tour-toc-blurb">{c.blurb}</span>
          </button>
        </li>
      ))}
    </ol>
  </div>
)

// Joyride gets the step without our own bookkeeping fields.
const toJoyrideStep = ({ chapter, ...step }) => step

/** Open filter menus in a gramene-search filter tree (nodes with showMenu). */
function openMenus(node, out = []) {
  if (!node) return out
  if (node.showMenu) out.push(node)
  ;(node.children || []).forEach((c) => openMenus(c, out))
  return out
}

/**
 * Undo the scaffolding a tour leaves when the visitor exits partway: the
 * suggestions it typed and any filter menu it opened (the expand-search steps
 * leave one open). The search itself, and its results, stay. Sites add their
 * own (e.g. SorghumBase's navbar search overlay) through `onExit`.
 */
function cleanUpAfterExit(props) {
  const { store, onExit } = props
  if (store) {
    if (typeof store.doClearSuggestions === 'function') store.doClearSuggestions()
    if (typeof store.doToggleGrameneFilterMenu === 'function') {
      // Nested menus close root-first just as well; each toggle only flips its node.
      openMenus(store.selectGrameneFilters && store.selectGrameneFilters())
        .forEach((node) => store.doToggleGrameneFilterMenu(node))
    }
  }
  if (typeof onExit === 'function') onExit()
}

const GeneSearchTourCmp = (props) => {
  const {
    buildSteps,
    primaryColor = '#a03e34',
    tocTitle,
    tocIntro,
    helpViewToc = true,
    debug = false
    // onExit: optional () => void, run after the built-in cleanup when the
    // visitor exits partway (close box or Esc); not on finishing.
  } = props

  // Steps read state through this ref, never through the props captured when the
  // tour started — a step's `before` hook may run many seconds later, by which
  // point views have mounted and searches have landed.
  const propsRef = useRef(props)
  propsRef.current = props

  const [steps, setSteps] = useState([])
  const [stepIndex, setStepIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [helpMount, setHelpMount] = useState(null)

  // Stop the tour; `exited` when the visitor left partway rather than finished.
  const stop = useCallback((exited) => {
    setRunning(false)
    if (exited) cleanUpAfterExit(propsRef.current)
  }, [])

  const handleEvent = useCallback((data) => {
    const { type, status, action, index } = data
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      stop(status === STATUS.SKIPPED)
      return
    }
    // Controlled mode: we own the index, so advance it ourselves once a step is
    // done. A step whose feature isn't present in this deployment, whose view
    // never mounted, or whose `before` hook threw or timed out shouldn't
    // dead-end the tour — treat it like a completed step and move on. Without
    // the ERROR case a slow setup leaves the tour showing nothing, with no way
    // forward.
    if (type === EVENTS.ERROR) {
      // Still skipped, but say why — a throwing `before` is otherwise silent.
      console.warn('gene-search-tour: step', index, 'skipped:', data.error || data)
    }
    if (
      type === EVENTS.STEP_AFTER ||
      type === EVENTS.TARGET_NOT_FOUND ||
      type === EVENTS.ERROR
    ) {
      setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1))
    }
  }, [stop])

  const { Tour } = useJoyride({
    steps,
    continuous: true,
    run: running,
    // Controlled mode. The table of contents has to be able to open the tour at
    // an arbitrary chapter, and neither controls.start(n) nor initialStepIndex
    // survives the re-render that delivers the steps — owning the index here is
    // the only deterministic option.
    stepIndex,
    onEvent: handleEvent,
    debug,
    options: {
      primaryColor,
      textColor: '#333',
      zIndex: TOUR_Z_INDEX,
      showProgress: true,
      // No Skip link: the close box and Esc both end the tour.
      buttons: ['back', 'primary', 'close'],
      closeButtonAction: 'skip',
      // Joyride's Esc can only close a step (which advances the tour), and only
      // while a tooltip is up; the listener below exits instead, at any point.
      dismissKeyAction: false,
      spotlightPadding: 6,
      spotlightRadius: 4,
      // Open each step's tooltip straight away. Without this Joyride shows a
      // beacon (a dot the visitor must click) for the first step of a run —
      // invisible on the full tour, whose first step is placement:'center', but
      // it silently stalls every chapter started from the table of contents.
      skipBeacon: true,
      // The sidebar and results are independent scroll panes on these pages, so
      // each step scrolls its own pane in `before` (see utils) and Joyride
      // must not also try to scroll the window.
      skipScroll: true,
      // Views mount asynchronously after their toggle action, and some steps
      // run a search or load an expression study first.
      targetWaitTimeout: 15000,
      beforeTimeout: 45000,
      overlayColor: 'rgba(0, 0, 0, 0.45)'
    },
    // `close` is the close box's aria-label and title (its tooltip).
    locale: { back: 'Back', close: 'Exit tour', last: 'Done', next: 'Next', skip: 'Exit tour' }
  })

  // Esc exits the tour, the same as the close box — including while a step's
  // `before` hook is still setting up, when Joyride shows only its loader.
  useEffect(() => {
    if (!running) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') stop(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [running, stop])

  /**
   * Start the tour, optionally from a later chapter.
   *
   * A chapter jump slices the step list rather than starting the tour at a
   * non-zero index: Joyride would run the target step's `before` hook but never
   * render its tooltip, whereas starting at index 0 is reliable. Slicing also
   * gives the chapter an honest progress count ("1 of 11") and stops Back from
   * walking into steps whose setup never ran. Chapter openers must each ensure
   * their own result set (see createTourKit's ensureSearch), so a sliced tour
   * stands alone.
   */
  const start = useCallback(
    (fromIndex = 0) => {
      const all = propsRef.current.buildSteps(() => propsRef.current).map(toJoyrideStep)
      setSteps(fromIndex > 0 ? all.slice(fromIndex) : all)
      setStepIndex(0)
      setRunning(true)
    },
    []
  )

  // startTour() from elsewhere on the page.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onStart = (e) => start((e.detail && e.detail.fromIndex) || 0)
    window.addEventListener(START_EVENT, onStart)
    return () => window.removeEventListener(START_EVENT, onStart)
  }, [start])

  // Autostart from ?tour=N — N is the 1-based step to open at, so ?tour=1 is
  // the beginning and a contents list on another page can link to a chapter
  // (chapter index + 1). Strip the param so a reload doesn't replay it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const value = url.searchParams.get(TOUR_PARAM)
    if (value) {
      url.searchParams.delete(TOUR_PARAM)
      window.history.replaceState({}, '', url.toString())
      const n = parseInt(value, 10)
      start(Number.isFinite(n) && n > 1 ? n - 1 : 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chapters = useMemo(() => tourChapters(buildSteps), [buildSteps])

  // gramene-search renders the [data-tour-view] wrapper for every view whether
  // it is on or off — only the header and body are conditional. So the portal
  // target existing is not enough: gate on the view actually being switched on,
  // or the contents list would sit in the results column with Help / Demo off.
  const viewsOn = props.grameneViewsOn
  const helpViewOn = !!(helpViewToc && viewsOn && viewsOn.has && viewsOn.has('help'))

  // Portals append, which would drop the contents list below the view's own
  // content. Mount into a node we insert directly after the view header instead,
  // so the list reads first for keyboard and screen-reader users too — a CSS
  // `order` would move it visually while leaving it last in the tab order.
  const mountRef = useRef(null)

  useEffect(() => {
    const detach = () => {
      const node = mountRef.current
      if (node && node.parentNode) node.parentNode.removeChild(node)
      mountRef.current = null
    }

    if (!helpViewOn) {
      detach()
      setHelpMount(null)
      return undefined
    }

    let cancelled = false
    const attach = () => {
      if (cancelled) return
      const section = document.querySelector('[data-tour-view="help"]')
      if (!section) return
      let node = mountRef.current
      if (!node || !node.isConnected) {
        node = document.createElement('div')
        node.className = 'gene-search-tour-mount'
        mountRef.current = node
      }
      const header = section.querySelector('.gramene-view-header')
      const anchor = header ? header.nextSibling : section.firstChild
      if (node.parentNode !== section || node.previousSibling !== header) {
        section.insertBefore(node, anchor)
      }
      setHelpMount(node)
    }

    attach()
    // The view's body can mount a tick after its wrapper; re-place if so.
    const t = setTimeout(attach, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [helpViewOn, viewsOn])

  // Take our node with us if the tour unmounts.
  useEffect(
    () => () => {
      const node = mountRef.current
      if (node && node.parentNode) node.parentNode.removeChild(node)
      mountRef.current = null
    },
    []
  )

  const toc = useMemo(
    () =>
      helpViewOn && helpMount
        ? createPortal(
            <TourContents chapters={chapters} onStart={start} title={tocTitle} intro={tocIntro} />,
            helpMount
          )
        : null,
    [helpViewOn, helpMount, chapters, start, tocTitle, tocIntro]
  )

  // Renders nothing where it sits — the tour is offered by the contents list in
  // the Help / Demo view (portaled), startTour() and ?tour=1.
  return (
    <>
      {toc}
      {Tour}
    </>
  )
}

/**
 * The store keys every tour step may use. redux-bundler throws on an unknown
 * selector, so the host's gramene-search must define all of them (2.38 is
 * known good).
 */
export const TOUR_STORE_KEYS = [
  'doClearGrameneFilters',
  'doReplaceGrameneFilters',
  'doAcceptGrameneSuggestion',
  'doChangeSuggestionsQuery',
  'doChangeSuggestionsTab',
  'doClearSuggestions',
  'doToggleGrameneView',
  'doToggleFacetCounts',
  'doExpandGeneDetail',
  'doSetHomologyViewer',
  'doSetExprVizActiveTaxon',
  'doSetExprVizFields',
  'doFetchExprVizData',
  'doSetExprVizVizMode',
  'doSetExprVizBrushes',
  'doSetOntologyEnrichmentActiveTaxon',
  'selectGrameneViewsOn',
  'selectGrameneFilters',
  'selectGrameneSearch',
  'selectGrameneFiltersStatus',
  'selectExprViz',
  'selectExpressionStudies',
  'selectExpressionSamples',
  'selectTargetTaxonId'
]

/**
 * Hands the store itself to the steps as `props.store`. redux-bundler-react's
 * connect wraps every `do…` key whether or not the store defines it, and the
 * wrapper throws when called, so steps can't tell from the prop alone whether a
 * site has an action (main has no doChangeSuggestionsTab, for one). The store
 * comes from the same legacy context connect itself reads.
 */
class WithStore extends React.Component {
  render() {
    return <GeneSearchTourCmp {...this.props} store={this.context.store} />
  }
}
WithStore.contextTypes = { store: () => {} }

/**
 * <GeneSearchTour buildSteps={…} primaryColor="…" /> — mount once, inside the
 * redux-bundler <Provider>, on every page that can show the gene search.
 */
const GeneSearchTour = connect(...TOUR_STORE_KEYS, WithStore)

export default GeneSearchTour
