// The toolkit tour steps are written against: store-aware helpers that put the
// gene search into the state a step needs (a result set, a view switched on, an
// expression study loaded) and find the elements gramene-search renders.
//
// `getProps` returns the tour component's latest props. Two things matter here:
// redux-bundler-react's connect passes selector *values* (grameneViewsOn,
// exprViz, …) rather than the selectX functions, and those values change as the
// app works — so every helper reads them fresh at call time rather than closing
// over a snapshot taken when the tour started. Action creators are read the same
// way, which also lets a site enumerate its steps before any store exists (see
// tourChapters).

import { waitForElement, waitFor, sleep, callIfPresent } from './utils'

/** Genome-level taxon ids are species*1000+n; study metadata is keyed by species. */
export function speciesTaxonId(tid) {
  const n = +tid
  return n > 1000000 ? Math.floor(n / 1000) : n
}

/** Leaf fq_values of a gramene-search filter tree, as strings. */
function filterValues(node, out = []) {
  if (!node) return out
  if (node.fq_value !== undefined) out.push(String(node.fq_value))
  ;(node.children || []).forEach((c) => filterValues(c, out))
  return out
}

/**
 * @param getProps  () => latest tour props (store values and actions)
 * @param config.prefix        class prefix gramene-search uses for this site's
 *                             containers: 'sorghumbase' on SorghumBase, else
 *                             'gramene' (.{prefix}-filter-container, …)
 * @param config.search        the suggestion(s) whose result set the tour runs
 *                             on: one {fq_field, fq_value, name, category} or
 *                             an array of them (ANDed)
 * @param config.taxon         genome the expression and enrichment steps show;
 *                             omit to follow gramene-search's derived
 *                             reference genome (targetTaxonId)
 * @param config.fallbackTaxon reference genome to use until /maps lands
 */
export default function createTourKit(getProps, config) {
  const { prefix = 'gramene', taxon, fallbackTaxon } = config
  const defaultSearch = [].concat(config.search || [])

  /**
   * Run a store action, or do nothing when this site's store lacks it. Goes
   * through the store itself when the engine provides it, so a step can use any
   * action, connected or not.
   */
  const act = (name, ...args) => {
    const { store, [name]: connected } = getProps()
    if (store) return callIfPresent(typeof store[name] === 'function' && store[name].bind(store), ...args)
    return callIfPresent(connected, ...args)
  }

  /** `.{prefix}-{name}` — e.g. cls('filter-container'). */
  const cls = (name) => `.${prefix}-${name}`

  // The genome the per-genome steps show. Unless the site pins one, the
  // reference genome gramene-search derives from the anchor genomes in /maps,
  // so it follows the deployment. Null until /maps lands, hence the fallback.
  const referenceTaxon = () => String(taxon || getProps().targetTaxonId || fallbackTaxon)

  const viewIsOn = (viewId) => {
    const on = getProps().grameneViewsOn
    return !!(on && on.has && on.has(viewId))
  }

  const ensureView = async (viewId, selector, timeout = 15000) => {
    if (!viewIsOn(viewId)) act('doToggleGrameneView', viewId)
    return selector ? !!(await waitForElement(selector, { timeout })) : true
  }

  /**
   * Guarantee a result set exists for exactly these filters (default: the
   * tour's search). Playing the tour linearly this is usually a no-op — earlier
   * steps already ran the search. It matters when a visitor jumps to a later
   * chapter from the contents list, where none of that has happened, and when a
   * chapter narrows or widens the set another chapter left behind.
   */
  const ensureSearch = async (filters = defaultSearch) => {
    const want = filters.map((f) => String(f.fq_value))
    const have = filterValues(getProps().grameneFilters)
    if ([...want].sort().join('\u0000') !== [...have].sort().join('\u0000')) {
      // Replace the whole tree in one action. Clearing and then accepting each
      // filter fires a search per intermediate state, and the unfiltered one
      // (every gene in the release) can land after the real one and stick.
      const current = getProps().grameneFilters || {}
      act('doReplaceGrameneFilters', {
        status: 'init',
        operation: 'AND',
        negate: false,
        marked: false,
        showMarked: false,
        showMenu: false,
        moveCopyMode: '',
        searchOffset: 0,
        rows: current.rows || 20,
        leftIdx: 0,
        rightIdx: 2 * filters.length + 1,
        children: filters.map((f, i) => ({
          ...f,
          leftIdx: 2 * i + 1,
          rightIdx: 2 * i + 2,
          negate: false,
          marked: false,
          showMenu: false
        }))
      })
    }
    // Wait on the search result itself, NOT on `.result-gene`: that markup only
    // exists while the Gene list view is switched on, and a chapter opened from
    // the contents list usually has every result view off — which stalled the
    // step for the full timeout before it did anything. Solr echoes the query
    // in responseHeader.params, so a stale response for some other filter set
    // can't pass for this one.
    const res = await waitFor(
      () => {
        const r = getProps().grameneSearch
        if (!(r && r.response && r.response.numFound > 0)) return null
        const params = JSON.stringify((r.responseHeader && r.responseHeader.params) || '')
        const matches = filters.every(
          (f) => params.indexOf(f.fq_field) !== -1 && params.indexOf(String(f.fq_value)) !== -1
        )
        return matches ? r : null
      },
      { timeout: 25000 }
    )
    return !!res
  }

  // ── Search suggestions ────────────────────────────────────────────────

  /**
   * The suggestion button for a given label. Buttons render as
   * `<Button id="{group}-{doc}">{display_name} <Badge/>…</Button>` inside
   * `#gramene-suggestion` groups (gramene-search/src/components/suggestions.js),
   * so match on the leading display name — "Jasmonic acid biosynthesis" and
   * "Jasmonic acid signaling" are otherwise easy to confuse.
   */
  const findSuggestion = (label) => {
    const buttons = document.querySelectorAll('.search-suggestions button')
    for (const b of buttons) {
      const text = (b.textContent || '').replace(/\s+/g, ' ').trim()
      if (text.indexOf(label) === 0) return b
    }
    return null
  }

  // ── Filters and "expand search" ───────────────────────────────────────

  /** The Filters-panel node whose text contains `label`. */
  const filterNode = (label) =>
    [...document.querySelectorAll('.gramene-filter-text')]
      .find((n) => (n.textContent || '').indexOf(label) !== -1) || null

  /**
   * Open a filter's menu, where the "expand search" radios live. Idempotent —
   * clicking the node again would close it.
   */
  const openFilterMenu = async (label) => {
    if (!document.querySelector('.gramene-filter-menu')) {
      const node = filterNode(label)
      if (!node) return null
      node.click()
      await waitForElement('.gramene-filter-menu', { timeout: 4000 }).catch(() => null)
    }
    return document.querySelector('.gramene-filter-menu')
  }

  /** Close that menu if it is open, so it doesn't sit over the next target. */
  const closeFilterMenu = (label) => {
    const node = filterNode(label)
    if (node && document.querySelector('.gramene-filter-menu')) node.click()
  }

  /**
   * Click one of the expansion radios and wait for the re-run search to land, so
   * the gene count in the panel visibly changes before we move on. Re-picking the
   * radio that is already selected clears the expansion.
   */
  const pickExpansion = async (filterLabel, option, dwell = 1200) => {
    const menu = await openFilterMenu(filterLabel)
    if (!menu) return false
    const row = [...menu.querySelectorAll('.gramene-filter-menu-radio')]
      .find((li) => (li.textContent || '').toLowerCase().indexOf(option) !== -1)
    if (!row) return false
    const before = (getProps().grameneSearch || {}).response
    const beforeCount = before ? before.numFound : null
    row.click()
    // Bounded: if a re-run is slow we move on rather than stalling the tour. The
    // caller's clearExpansion is what guarantees we don't leave the set
    // expanded, so a timeout here is survivable.
    await waitFor(
      () => {
        const r = getProps().grameneSearch
        const n = r && r.response ? r.response.numFound : null
        return n !== null && n !== beforeCount ? n : null
      },
      { timeout: 8000 }
    ).catch(() => null)
    // The store having the new count isn't enough — the panel only prints the
    // tally once the search reaches 'ready', and the point is watching that
    // number move. Wait for it to be on screen before dwelling.
    await waitFor(
      () => (getProps().grameneFiltersStatus === 'ready' ? true : null),
      { timeout: 8000 }
    ).catch(() => null)
    await sleep(dwell)
    return true
  }

  /**
   * Clear whichever expansion is selected, by re-picking the checked radio.
   * Reads the checked state rather than assuming which one was applied, so it
   * still works if a sequence stopped part-way.
   */
  const clearExpansion = async (filterLabel) => {
    const menu = await openFilterMenu(filterLabel)
    if (!menu) return false
    const checked = [...menu.querySelectorAll('.gramene-filter-menu-radio')]
      .find((li) => {
        const radio = li.querySelector('input[type=radio]')
        return radio && radio.checked
      })
    if (!checked) return true // nothing applied
    checked.click()
    await waitFor(
      () => (document.querySelector('.gramene-filter-expansion') ? null : true),
      { timeout: 8000 }
    ).catch(() => null)
    return true
  }

  // ── Results ───────────────────────────────────────────────────────────

  /** The result card for one gene id. */
  const findGeneCard = (geneId) => {
    const cards = document.querySelectorAll('.result-gene')
    for (const c of cards) {
      if ((c.textContent || '').indexOf(geneId) !== -1) return c
    }
    return null
  }

  /** An element inside one gene's card. */
  const inGeneCard = (geneId, selector) => {
    const c = findGeneCard(geneId)
    return c ? c.querySelector(selector) : null
  }

  // ── Expression visualization ──────────────────────────────────────────

  /**
   * An element inside Expression visualization's *visible* genome tab.
   *
   * react-bootstrap Tabs mount every pane, so `.exprviz-hm-container` and
   * `.exprviz-pc-container` also exist inside the hidden panes of the other
   * genomes at 0x0. Matching one of those makes a step look ready and then fail
   * to anchor, which silently skipped the heatmap. Scope to `.exprviz-view` too —
   * the navbar's suggestions widget uses `.tab-pane` as well.
   */
  const exprVizActive = (selector) => {
    const pane = document.querySelector('.exprviz-view .tab-pane.active')
    return pane ? pane.querySelector(selector) : null
  }

  /**
   * Wait until Expression visualization has real content.
   *
   * ExprVizView renders `.exprviz-view` in every state — "Loading studies…",
   * "No expression studies for current results", and the populated view — so the
   * element existing says nothing about readiness. The genome tabs come from the
   * pivot facet, so wait for that instead.
   */
  const waitForExprVizReady = async (timeout = 30000) => {
    const ev = await waitFor(
      () => {
        const v = getProps().exprViz
        const pivot = v && v.pivot
        return pivot && pivot.status === 'ready' && Object.keys(pivot.data || {}).length
          ? v
          : null
      },
      { timeout }
    )
    return !!ev
  }

  /**
   * Drive Expression visualization to an actual plot. Left alone the view only
   * offers empty genome tabs, because it needs a genome, a set of sample columns
   * and an explicit "Load data" before it draws anything. This walks that whole
   * path: pick the genome, choose a study that has samples, turn its sample
   * groups into `{study}_{group}__expr` field names, and load.
   *
   * Returns {taxon, study, fields} once rows have arrived, else null.
   */
  const loadExpression = async (taxon = referenceTaxon()) => {
    const mounted = await ensureView('exprViz', '.exprviz-view', 20000)
    if (!mounted) return null
    if (!(await waitForExprVizReady())) return null
    act('doSetExprVizActiveTaxon', taxon)
    // Start from a clean, comparable state. vizMode and brushes are remembered
    // per taxon, so a previous run of this chapter (which ends in parallel mode
    // with an axis brushed) would otherwise skip the heatmap step entirely —
    // the heatmap simply isn't rendered unless vizMode is 'heatmap' — and show
    // a pre-filtered plot before the step that explains filtering.
    act('doSetExprVizVizMode', taxon, 'heatmap')
    act('doSetExprVizBrushes', taxon, {})

    // Study/sample metadata is fetched once the view is on.
    const studies = await waitFor(() => {
      const all = getProps().expressionStudies
      const list = all && (all[taxon] || all[speciesTaxonId(taxon)])
      return list && list.length ? list : null
    }, { timeout: 25000 })
    if (!studies) return null

    const samplesByStudy = getProps().expressionSamples || {}
    const fieldsFor = (s) => {
      const samples = samplesByStudy[s._id]
      if (!samples || !samples.length) return []
      const firstPerGroup = {}
      samples.forEach((x) => { if (!firstPerGroup[x.group]) firstPerGroup[x.group] = x })
      return Object.keys(firstPerGroup).map(
        (g) => `${String(s._id).replace(/-/g, '_')}_${g}__expr`
      )
    }

    // Choose a study that actually demonstrates something. Whichever study
    // happens to be first is a poor demo — it may be a two-sample comparison, or
    // a 100-sample time course that would swamp the plot. Prefer a baseline
    // (tissue/development) study with a readable number of samples; fall back to
    // the first study with any.
    const candidates = studies
      .map((s) => ({ s, fields: fieldsFor(s) }))
      .filter((c) => c.fields.length)
    if (!candidates.length) return null
    const readable = candidates.filter((c) => c.fields.length >= 4 && c.fields.length <= 24)
    const baseline = readable.filter((c) => /baseline/i.test(c.s.type || ''))
    const pool = baseline.length ? baseline : (readable.length ? readable : candidates)
    const best = pool.reduce((a, b) => (b.fields.length > a.fields.length ? b : a))

    act('doSetExprVizFields', taxon, best.fields)
    act('doFetchExprVizData', taxon)

    const loaded = await waitFor(() => {
      const ev = getProps().exprViz
      const t = ev && ev.byTaxon && ev.byTaxon[taxon]
      return t && t.rows && t.rows.length ? t : null
    }, { timeout: 30000 })
    if (!loaded) return null
    return { taxon, study: best.s, fields: best.fields }
  }

  /**
   * Brush one axis so that roughly the top third of genes stay selected.
   * Picking the cut by percentile rather than by half the value range keeps the
   * demo meaningful whatever the distribution looks like — expression is skewed,
   * so "top half of the range" can easily select one gene or all of them.
   */
  const brushTopOfFirstAxis = (taxon, fields) => {
    const ev = getProps().exprViz
    const t = ev && ev.byTaxon && ev.byTaxon[taxon]
    if (!t || !t.rows || !fields || !fields.length) return false
    const field = fields[0]
    const values = t.rows.map((r) => +r[field]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    if (values.length < 3) return false
    const hi = values[values.length - 1]
    const lo = values[Math.floor(values.length * 0.66)]
    if (!(hi > lo)) return false
    act('doSetExprVizBrushes', taxon, { [field]: [lo, hi] })
    return true
  }

  return {
    getProps,
    act,
    cls,
    search: defaultSearch,
    referenceTaxon,
    viewIsOn,
    ensureView,
    ensureSearch,
    findSuggestion,
    filterNode,
    openFilterMenu,
    closeFilterMenu,
    pickExpansion,
    clearExpansion,
    findGeneCard,
    inGeneCard,
    exprVizActive,
    waitForExprVizReady,
    loadExpression,
    brushTopOfFirstAxis
  }
}
