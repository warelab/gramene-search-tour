// Step builders for the parts of the tour every gramene-search site shares:
// reading a result set, one gene's evidence, and the tools that work on the
// whole set. A site's buildSteps composes these after its own search intro
// (which differs per site — a navbar spyglass on SorghumBase, an always-open
// search bar on Gramene).
//
// Every step is anchored either to a class rendered explicitly in
// gramene-search, or to a function that resolves the element at run time
// (react-joyride v3 accepts a function target). Any step needing UI that is
// collapsed, switched off or not yet fetched brings it up in its own async
// `before` hook — v3 awaits that promise behind a loader, so a step never fires
// at a target that hasn't mounted.
//
// Each builder takes `chapter` ({title, blurb}, or null for none) for the step
// that opens it, and `copy` — per-step {title, content} overrides keyed by the
// names in the builder's doc comment — for wording that is site-specific.

import { revealTarget, waitForElement, waitFor, sleep } from './utils'

const applyCopy = (steps, copy = {}) =>
  steps.map(({ key, ...step }) => (copy[key] ? { ...step, ...copy[key] } : step))

const withChapter = (steps, chapter) =>
  chapter ? [{ ...steps[0], chapter }, ...steps.slice(1)] : steps

// Tall targets: a `placement: 'top'` tooltip needs room reserved above them, or
// it renders clipped off the top edge — Joyride can't flip it below a target
// taller than the viewport. Proportional so short screens keep the target in view.
const roomAbove = (max, frac) => Math.min(max, Math.round(window.innerHeight * frac))

/**
 * The result set: the search panel, the distribution, the Filters panel and the
 * three "expand search" options, then the gene list.
 *
 * opts.filterLabel  text of the filter node the expansions are applied to
 * opts.enter        async hook run first by the opening step (e.g. click the
 *                   suggestion the previous step pointed at)
 * copy keys: panel, distribution, filters, expand, orthologs, paralogs,
 *            neighborhood, geneList
 */
export function resultSetSteps(kit, { chapter, filterLabel, enter, copy } = {}) {
  const sidebar = kit.cls('sidebar')
  const filterContainer = kit.cls('filter-container')
  const menuOrFilters = () =>
    document.querySelector('.gramene-filter-menu') || document.querySelector(filterContainer)

  // One "expand search" option per step, so the visitor reads about an
  // expansion while looking at the count that expansion produced.
  const expansionBefore = (option) => async () => {
    if (!(await kit.ensureSearch())) return false
    await revealTarget(filterContainer, { block: 'start' })
    // dwell 0: the step itself holds the state for as long as the visitor reads.
    await kit.pickExpansion(filterLabel, option, 0)
    return !!(await kit.openFilterMenu(filterLabel))
  }

  const steps = [
    {
      key: 'panel',
      target: sidebar,
      placement: 'right',
      title: 'The search panel',
      content:
        `Accepting a suggestion runs the search. The left panel is now the state of ` +
        `that search: how many genes matched, the filters that produced them, and ` +
        `the views available to explore them.`,
      before: async () => {
        if (enter) await enter()
        if (!(await kit.ensureSearch())) return false
        // Later steps in this chapter point at the distribution and the gene
        // list, so make sure both views are actually on.
        await kit.ensureView('taxTree', '.results-vis')
        await kit.ensureView('list', '.result-gene')
        return revealTarget(sidebar, { block: 'start' })
      }
    },
    {
      key: 'distribution',
      target: '.results-vis',
      placement: 'bottom',
      title: 'Where the matches are',
      content:
        `The top of the results shows how the matching genes are distributed across ` +
        `the species tree and along the genome — a quick read on whether a result ` +
        `set is broad or concentrated.`,
      before: async () => {
        // Backstop: the neighborhood step's `after` does not run when the
        // visitor hits Skip, so an abandoned tour could otherwise leave the set
        // expanded. clearExpansion() is a no-op when nothing is applied.
        await kit.clearExpansion(filterLabel)
        return revealTarget('.results-vis', { block: 'start' })
      }
    },
    {
      key: 'filters',
      target: filterContainer,
      placement: 'right',
      title: 'Filters build the query',
      // Don't inherit the previous step's scroll position — stepping Back
      // arrives here with the sidebar scrolled elsewhere.
      before: async () => revealTarget(filterContainer, { block: 'start' }),
      content:
        `The term you accepted is now a filter, shown as "category | value". ` +
        `Filters combine with AND by default, so you can keep adding terms — a ` +
        `species, an expression class, a gene list — to narrow the set. Click one to negate it, ` +
        `switch AND/OR, or remove it.`
    },
    {
      // Intro: open the menu and explain the idea, but change nothing yet.
      key: 'expand',
      target: menuOrFilters,
      placement: 'right',
      title: 'Expand the search',
      content:
        `Filters only ever narrow the search. "Expand search" grows it along a ` +
        `biological relationship instead: the genes you matched become the ` +
        `starting point, and the result is those genes plus everything reachable ` +
        `from them. There are three ways to do it — orthologs, paralogs and ` +
        `neighborhood. We take them one at a time; watch the gene count and taxonomic distribution as each ` +
        `is applied.`,
      before: async () => {
        if (!(await kit.ensureSearch())) return false
        await revealTarget(filterContainer, { block: 'start' })
        // Start clean: replaying this chapter must not inherit an expansion left
        // behind by an earlier pass.
        await kit.clearExpansion(filterLabel)
        return !!(await kit.openFilterMenu(filterLabel))
      }
    },
    {
      key: 'orthologs',
      target: menuOrFilters,
      placement: 'right',
      title: 'Expand by orthologs',
      content:
        `Orthologs are the equivalent genes in other genomes. This keeps every ` +
        `gene you already had and adds their counterparts in the other species, ` +
        `so the count climbs and the set spreads out across the species tree.`,
      before: expansionBefore('orthologs')
    },
    {
      key: 'paralogs',
      target: menuOrFilters,
      placement: 'right',
      title: 'Expand by paralogs',
      content:
        `Paralogs stay inside a single genome — copies that arose by duplication ` +
        `rather than speciation. These are radio options, so picking paralogs ` +
        `switches straight from orthologs: the count changes in character as ` +
        `well as in size.`,
      before: expansionBefore('paralogs')
    },
    {
      key: 'neighborhood',
      target: menuOrFilters,
      placement: 'right',
      title: 'Expand by neighborhood',
      content:
        `Neighborhood takes the ten genes either side of each match along the ` +
        `chromosome — genomic context rather than homology. Picking the selected ` +
        `option again clears it, which is what happens as we leave this step, so ` +
        `the rest of the tour runs on the plain search.`,
      before: expansionBefore('neighborhood'),
      after: async () => {
        await kit.clearExpansion(filterLabel)
        kit.closeFilterMenu(filterLabel)
      }
    },
    {
      key: 'geneList',
      target: '.result-gene',
      placement: 'top',
      title: 'The gene list',
      content:
        `Below the taxonomic distribution is the paginated list of matching genes, each with its ` +
        `species, identifiers and description.`,
      before: async () => revealTarget('.result-gene', { block: 'start' })
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}

/**
 * One gene: its card, the evidence tabs, Pathways, and the Homology tree in
 * TBrowse with its zones.
 *
 * opts.gene    the gene id (must be on the first page of opts.search's results)
 * opts.search  filters for this chapter's result set (default: the tour's)
 * copy keys: card (required: there is no generic wording for why this gene),
 *            tabs, pathways, tree, zones
 */
export function geneSteps(kit, { chapter, gene, search, copy } = {}) {
  const card = () => kit.findGeneCard(gene)
  const inCard = (selector) => () => kit.inGeneCard(gene, selector)

  const steps = [
    {
      key: 'card',
      target: card,
      placement: 'top',
      title: `${gene} is one of these genes`,
      content: `Let's look at the evidence behind ${gene}.`,
      before: async () => {
        await kit.ensureSearch(search)
        await kit.ensureView('list', '.result-gene')
        const c = await waitFor(card, { timeout: 15000 })
        if (!c) return false
        return revealTarget(c, { block: 'start' })
      }
    },
    {
      key: 'tabs',
      target: inCard('.gene-detail-tabs'),
      placement: 'top',
      title: 'Evidence for each gene',
      content:
        `Each gene carries a row of tabs — Sequences, Location, Expression, ` +
        `Homology, Pathways, Papers, Xrefs and more. A tab is only offered when ` +
        `that evidence exists for the gene.`,
      before: async () => {
        const tabs = kit.inGeneCard(gene, '.gene-detail-tabs')
        if (!tabs) return false
        return revealTarget(tabs, { block: 'center' })
      }
    },
    {
      key: 'pathways',
      target: inCard('.pathways-container'),
      placement: 'top',
      title: 'Pathways: where the gene acts',
      content:
        `The tree on the left lists every Plant Reactome pathway and reaction the ` +
        `gene takes part in; the diagram shows the selected one with the gene ` +
        `flagged.`,
      before: async () => {
        await kit.ensureSearch(search)
        if (!(await waitFor(card, { timeout: 15000 }))) return false
        kit.act('doExpandGeneDetail', { geneId: gene, detail: 'pathways' })
        // The hierarchy needs a pathway-doc fetch before it picks a node, and the
        // explore link under the diagram only renders once one is selected.
        const tree = await waitFor(
          inCard('.pathways-tree-panel .rstm-tree-item--active, .pathways-tree-empty'),
          { timeout: 20000 }
        )
        if (!tree) return false
        // The diagram is Reactome's GWT widget inside a srcdoc iframe (same
        // origin, so readable). Give it a chance to draw before the spotlight
        // lands, but don't drop the step if Reactome is slow.
        await waitFor(
          () => {
            const frame = kit.inGeneCard(gene, '.pathways-diagram-panel iframe')
            const doc = frame && frame.contentDocument
            return doc ? doc.querySelector('#holder canvas') : null
          },
          { timeout: 10000 }
        )
        // Taller than the space a top-placed tooltip leaves at block 'start'
        // (500px diagram plus links).
        return revealTarget(inCard('.pathways-container'), {
          block: 'start', margin: roomAbove(320, 0.36), settle: 800
        })
      }
    },
    {
      key: 'tree',
      target: inCard('.gene-genetree'),
      placement: 'top',
      title: 'TBrowse: the gene family tree',
      content:
        `Opening Homology draws the gene family tree in TBrowse and the multiple sequence alignment zone (MSA). ` +
        `Click a triangle to expand or collapse a branch, or a ` +
        `gene name for more details. ` +
        `Protein domains are color coded; zoom in to the amino acid sequence level. `,
      before: async () => {
        kit.act('doExpandGeneDetail', { geneId: gene, detail: 'homology' })
        // Homology remembers its viewer per gene; force TBrowse so the zone
        // buttons the next step points at are the ones that render.
        kit.act('doSetHomologyViewer', { geneId: gene, viewer: 'tbrowse' })
        const tree = await waitFor(inCard('.gene-genetree'), { timeout: 20000 })
        if (!tree) return false
        return revealTarget(tree, { block: 'start', settle: 700 })
      }
    },
    {
      key: 'zones',
      target: inCard('.gene-genetree'),
      placement: 'bottom',
      title: 'Explore regional and functional conservation',
      content:
        `Switch between zones: Neighborhood to compare ±10 flanking genes, and ` +
        `Expression to read an organ-level heatmap for genes with expression data.`,
      before: async () => {
        const zone = await waitFor(inCard('.gene-genetree .tbrowse-zone-toggle'), { timeout: 15000 })
        if (!zone) return false
        return revealTarget(zone, { block: 'start' })
      }
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}

/** Refine: facet counts for the current results. copy key: refine */
export function refineSteps(kit, { chapter, copy } = {}) {
  const container = kit.cls('facet-container')
  const steps = [
    {
      key: 'refine',
      target: container,
      placement: 'right',
      title: 'Refine: what else is in this set',
      content:
        `Refine counts your current results by category, so you can see what you ` +
        `have before narrowing further. It stays collapsed until you open it, and ` +
        `the counts always describe the search in front of you. The number beside each ` +
        `value is how many of your genes match it — click it and that becomes a ` +
        `new filter, ANDed onto the search.`,
      before: async () => {
        await kit.ensureSearch()
        kit.act('doToggleFacetCounts', true)
        // Counts arrive from a facet query — wait for real values.
        await waitForElement('.facet-count', { timeout: 20000 })
        return revealTarget(container, { block: 'start' })
      }
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}

/** The Views panel and the Gene attributes table. copy keys: views, attrTable */
export function viewsSteps(kit, { chapter, copy } = {}) {
  const steps = [
    {
      key: 'views',
      target: '.gramene-view-container',
      placement: 'right',
      title: 'Views sidebar panel',
      content:
        `The same result set can be read many ways. Toggle a view on to add it to ` +
        `the results column; click its name to jump straight to it.`,
      before: async () => {
        await kit.ensureSearch()
        return revealTarget('.gramene-view-container', { block: 'start' })
      }
    },
    {
      key: 'attrTable',
      target: '.attrtable-aggrid',
      placement: 'top',
      title: 'Gene attributes',
      content:
        `Gene attributes puts the whole result set in one sortable table — maximum ` +
        `expression, an organ-level heatmap, expression class, and the conditions ` +
        `that activate or repress each gene. Click any cell to filter the search on that value.`,
      before: async () => {
        const ok = await kit.ensureView('attrTable', '.attrtable-aggrid')
        if (!ok) {
          if (kit.viewIsOn('attrTable')) kit.act('doToggleGrameneView', 'attrTable')
          return false
        }
        return revealTarget('.attrtable-aggrid', {
          block: 'start', margin: roomAbove(360, 0.42), settle: 700
        })
      }
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}

/**
 * Expression visualization on the reference genome: the view, a loaded
 * heatmap, parallel coordinates, and a brushed axis.
 * copy keys: exprViz (name the genome here), heatmap, parallel, brush
 */
export function expressionSteps(kit, { chapter, copy } = {}) {
  // What loadExpression() loaded, so the parallel-coords and brushing steps can
  // reuse the same taxon/fields.
  let exprInfo = null

  const steps = [
    {
      key: 'exprViz',
      target: '.exprviz-view',
      placement: 'center',
      title: 'Expression visualization',
      content:
        `Expression data is per genome, so this view opens on a tab per genome in ` +
        `your results. We've picked the reference genome, and now need to choose ` +
        `which samples to plot.`,
      before: async () => {
        await kit.ensureSearch()
        const ok = await kit.ensureView('exprViz', '.exprviz-view', 20000)
        if (!ok) return false
        // The view mounts instantly with a placeholder; wait for the genome tabs.
        if (!(await kit.waitForExprVizReady())) return false
        kit.act('doSetExprVizActiveTaxon', kit.referenceTaxon())
        return revealTarget('.exprviz-view', { block: 'start', settle: 600 })
      }
    },
    {
      key: 'heatmap',
      target: () => kit.exprVizActive('.exprviz-hm-container'),
      placement: 'center',
      title: 'Pick samples, then load',
      content:
        `Choose fields to add sample columns — grouped by study, so you can take a ` +
        `whole experiment at once — then press Load data. We've loaded one ` +
        `study: each row is a gene, each column a sample, and the color is its ` +
        `expression level. Hover any cell for the sample's study, group and factors.`,
      before: async () => {
        const loaded = await kit.loadExpression()
        if (!loaded) return false
        exprInfo = loaded
        const hm = await waitFor(() => kit.exprVizActive('.exprviz-hm-container'), { timeout: 20000 })
        if (!hm) return false
        return revealTarget(hm, { block: 'start', settle: 800 })
      }
    },
    {
      key: 'parallel',
      target: () => kit.exprVizActive('.exprviz-pc-container'),
      placement: 'top',
      title: 'Or read it as parallel coordinates',
      content:
        `The same data, drawn as one line per gene across an axis per sample. ` +
        `Genes that track together stay parallel; a gene that spikes in one ` +
        `condition crosses the others. Axes can be dragged to reorder them.`,
      before: async () => {
        if (!exprInfo) return false
        kit.act('doSetExprVizVizMode', exprInfo.taxon, 'parallel')
        const pc = await waitFor(() => kit.exprVizActive('.exprviz-pc-container'), { timeout: 20000 })
        if (!pc) return false
        return revealTarget(pc, { block: 'start', settle: 800 })
      }
    },
    {
      key: 'brush',
      target: () => kit.exprVizActive('.exprviz-pc-container'),
      placement: 'top',
      title: 'Brush an axis to filter',
      content:
        `Drag along any axis to keep only the genes falling in that range — we've ` +
        `brushed the top of the first sample. Brushes on several axes ` +
        `intersect, so you can isolate genes that are high in one condition and low ` +
        `in another, then turn that selection into a search filter.`,
      before: async () => {
        if (!exprInfo) return false
        kit.brushTopOfFirstAxis(exprInfo.taxon, exprInfo.fields)
        await sleep(600)
        const pc = kit.exprVizActive('.exprviz-pc-container')
        if (!pc) return false
        return revealTarget(pc, { block: 'start', settle: 600 })
      }
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}

/**
 * Ontology enrichment, user gene lists, the exporter, and saving a search.
 * copy keys: enrichment (name the genome here), userLists, export, auth
 */
export function setToolsSteps(kit, { chapter, copy } = {}) {
  const auth = kit.cls('auth-container')
  const steps = [
    {
      key: 'enrichment',
      target: '.oe-view',
      placement: 'top',
      title: 'Ontology Enrichment',
      content:
        `Enrichment asks which GO, Plant Ontology or Trait Ontology terms turn up ` +
        `in your results more often than chance would predict, with fold enrichment ` +
        `and an adjusted p-value for each. Pick the species on the left — we've ` +
        `selected the reference genome.`,
      before: async () => {
        await kit.ensureSearch()
        const ok = await kit.ensureView('ontologyEnrichment', '.oe-view', 20000)
        if (!ok) return false
        // Without this the view lands on whichever genome sorts first — often
        // Chlamydomonas — and shows nothing useful.
        kit.act('doSetOntologyEnrichmentActiveTaxon', kit.referenceTaxon())
        // Foreground and background counts are two more fetches; wait for the
        // panel to actually report them rather than guessing at a delay.
        await waitFor(
          () => {
            const panel = document.querySelector('.oe-panel')
            return panel && /Foreground:/.test(panel.textContent || '') ? panel : null
          },
          { timeout: 30000 }
        )
        return revealTarget('.oe-view', { block: 'start', settle: 700 })
      }
    },
    {
      key: 'userLists',
      target: '[data-tour-view="userLists"]',
      placement: 'top',
      title: 'User Gene Lists',
      content:
        `Bring your own genes. Paste or drop a list of IDs on the left and they're ` +
        `checked against the database; sign in to save the list, privately or ` +
        `publicly. Saved lists — yours and any made public — appear on the right: ` +
        `View turns one into a "Gene List" filter you can combine with other terms. ` +
        `Deleted lists wait in Trash for 30 days.`,
      before: async () => {
        // gramene-search drops this view entirely when the site has no Firebase
        // config, and every available view gets a data-tour-view wrapper whether
        // it's on or not — so a missing wrapper means skip, without toggling a
        // view that doesn't exist and waiting out the element timeout.
        if (!document.querySelector('[data-tour-view="userLists"]')) return false
        const ok = await kit.ensureView('userLists', '.gene-list-display-component')
        if (!ok) {
          if (kit.viewIsOn('userLists')) kit.act('doToggleGrameneView', 'userLists')
          return false
        }
        // Taller than most viewports (textarea plus a 500px list table).
        return revealTarget('[data-tour-view="userLists"]', {
          block: 'start', margin: roomAbove(360, 0.42), settle: 500
        })
      }
    },
    {
      key: 'export',
      target: '.exporter-view',
      placement: 'top',
      title: 'Data exporter',
      content:
        `Anything you can search, you can take with you: pick the fields you want ` +
        `and export the result set as a table.`,
      before: async () => {
        const ok = await kit.ensureView('export', '.exporter-view')
        if (!ok) return false
        return revealTarget('.exporter-view', { block: 'start', settle: 500 })
      }
    },
    {
      key: 'auth',
      target: auth,
      placement: 'right',
      title: 'Keep what you built',
      content:
        `Sign in to save a search — filters, views and open tabs — as a link you can ` +
        `share or return to.`,
      before: async () => revealTarget(auth, { block: 'start' })
    }
  ]
  return withChapter(applyCopy(steps, copy), chapter)
}
