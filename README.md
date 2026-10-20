# gramene-search-tour

A guided-tour engine for [gramene-search](https://github.com/warelab/gramene-search)
gene search sites, built on [react-joyride](https://react-joyride.com) v3. It also
ships the step builders the sites share. SorghumBase (`sorghum-webapp/search_app`)
and Gramene (`gramene-sites`) each keep a short steps file of their own: the
search intro, the example gene, and anything else they word differently.

## Using it

```js
import { GeneSearchTour, TourContents, tourChapters } from 'gramene-search-tour'
import 'gramene-search-tour/dist/tour.css'
import buildSteps from './tourSteps'

// Mount once, inside the redux-bundler <Provider>, wherever the search UI lives.
<GeneSearchTour buildSteps={buildSteps} primaryColor="#198754"/>

// Optional: a contents list anywhere else on the page (e.g. a welcome page).
<TourContents chapters={tourChapters(buildSteps)}/>
```

There are four ways to start the tour:

- the contents list that the engine portals into the Help / Demo view (turn it off with `helpViewToc={false}`)
- any `<TourContents/>`, or a call to `startTour(stepIndex)`
- loading the page with `?tour=1`

Set `--gene-search-tour-accent` on `.gene-search-tour-toc` to color the contents list.
Pass `debug` to log Joyride's lifecycle. Skipped steps are always logged with `console.warn`.

## Writing a site's steps

```js
import { createTourKit, resultSetSteps, geneSteps, refineSteps,
         viewsSteps, expressionSteps, setToolsSteps } from 'gramene-search-tour'

export default function buildSteps(getProps) {
  const kit = createTourKit(getProps, {
    prefix: 'gramene',          // container classes: .gramene-sidebar, .gramene-filter-container…
    search: PATHWAY_SUGGESTION, // the filter(s) the chapters run on
    taxon: 3702001              // genome for the expression/enrichment steps (optional)
  })
  return [
    { chapter: { title: 'Run a search', blurb: '…' }, target: …, before: async () => … },
    ...resultSetSteps(kit, { chapter: {…}, filterLabel: 'Jasmonic acid biosynthesis' }),
    ...geneSteps(kit, { chapter: {…}, gene: 'AT3G45140', copy: { card: { title, content } } }),
    ...refineSteps(kit, { chapter: {…} }),
    ...viewsSteps(kit, { chapter: {…} }),
    ...expressionSteps(kit, { chapter: {…} }),
    ...setToolsSteps(kit, { chapter: {…} })
  ]
}
```

- A step that carries `chapter: {title, blurb}` opens a chapter in the contents list.
- A chapter can be started directly, so its first step must set up its own result set. `kit.ensureSearch()` does that.
- Each builder takes `copy`, which overrides a step's `title` and `content` by key. The keys are listed in `src/steps.js`.
- Steps call store actions through `kit.act(name, …args)`. It does nothing if the site's store has no such action.

## Developing

```sh
npm run build                                  # dist/index.mjs, dist/index.cjs, dist/tour.css
scripts/install-local.sh ../gramene-sites ../sorghum-webapp/search_app
```

Until the package is published, sites depend on `file:vendor/gramene-search-tour-<version>.tgz`.
`install-local.sh` builds, packs and installs that tarball. Both sites gitignore `*.tgz`,
so commit the tarball with `git add -f`.
