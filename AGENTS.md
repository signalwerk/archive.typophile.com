# AGENTS.md

Working notes for coding agents on this repository. Read this before changing
anything; `README.md` is the human-facing document and goes deeper on the
archive-fetching side.

## Keep this file current

**Every agent must update `AGENTS.md` as part of any meaningful change.** When
you alter the architecture, add or renumber a pipeline step, change a data
shape or file layout, discover a gotcha, confirm or refute an assumption
recorded here, or learn something a future agent would otherwise rediscover the
hard way — edit this file in the same piece of work, not afterwards.

Preserve what is still true, delete what has gone stale, and correct what is
wrong. A confidently wrong line here is worse than no line: everything below
should be something you have verified, not something you assume.

## What this is

Typophile, a typography discussion board, went offline in 2015. This project
recovers it from three web archives (`web.archive.org`, `arquivo.pt`,
`commoncrawl.org`), parses the recovered pages into YAML, and renders a static
site from them.

Two separate npm packages, deliberately:

- the repository root — the pipeline (Node, ESM, no build step)
- `site/` — the site generator (Vite + React, its own `node_modules`)

Node v24. The only root dependencies are `cheerio` and `yaml`.

## Scale — assume nothing is small

| | |
| --- | --- |
| threads | 62,469 (`data/parsed/nodes/<id>.yaml`) |
| comments | 392,512 |
| members | 25,573 files, 25,038 with numeric ids |
| embedded files | 24,615 (`data/parsed/files/`, 2.7 GB) |
| `data/parsed` total | 3.5 GB |

Consequences that bite:

- **Shell globs overflow.** `ls data/parsed/nodes/*.yaml` dies with "argument
  list too long". Use `find data/parsed/nodes -name '*.yaml'`.
- `data/parsed/state.json` is ~103 MB; parsing it takes ~450 ms.
- A full pass over every thread costs roughly a minute of YAML parsing.

## Commands

Whole pipeline, in order, resumable and safe to re-run: `sh get.sh`

| step | command | what it does | cost |
| --- | --- | --- | --- |
| 0–4 | `npm run index` / `cutoff` / `latest` / `list` / `download` | fetch indexes, find the offline cutoff, download captures | network-bound |
| 5 | `npm run select` | pick which archived copy of each node to parse | |
| 6 | `npm run parse` | parse pages into `data/parsed/nodes/<id>.yaml` | slow; see the trap below |
| 7 | `npm run users` | one file per member + `users/_index.jsonl` | |
| 8 | `npm run clean` | produce `html_clean` from `html` | ~4 min |
| 9 | `npm run threads` | write `nodes/_index.jsonl` | ~60 s cold, ~1 s warm |

Site, from `site/`: `npm run dev` (port 5173) and `npm run build`. The build
renders all ~63k routes every time — there is no incremental build — and then
copies the 2.7 GB of embedded files into `dist/`. Rendering itself is cheap
(~1 ms/page, measured); the copy is not. Time it before assuming.

## Architecture

```
archives ──0-4──> data/archives/<archive>/files/…      raw captures, digest-verified
             5-6──> data/parsed/nodes/<id>.yaml         one thread per file
               7──> data/parsed/users/<id>.yaml + _index.jsonl
               8──> html_clean written into each thread YAML
               9──> data/parsed/nodes/_index.jsonl      one summary line per thread
                     │
                     └──> site/  reads the two _index.jsonl files and one YAML per page
```

The site does **no** content processing at request time. It injects the stored
`html_clean` string and nothing more — no sanitising, no link rewriting. All of
that happened once, in step 8.

### Step 8 is deliberately one self-contained file

`src/008_cleanHtml.js` (~560 lines) holds everything the cleaning needs: URL
knowledge, the document walk, and the corpus pass, in three labelled sections.
It was split across `src/lib/cleanHtml.js` and `src/lib/links.js` and was
merged in on purpose, so that what happens to a post can be read in one place.
**Do not split it back out** without the owner asking.

### Invariants worth protecting

- **`html` is never modified.** Step 8 derives `html_clean` beside it. This is
  what makes changing the cleaning cheap: re-running step 8 is ~4 minutes,
  whereas re-deriving from the archives means steps 5–6. The original costs
  ~37% of the stored bytes and is worth it.
- **A link to something we do not hold keeps its original address.** Never
  invent a destination.
- **Never guess a page generation.** An unmatched page is logged as an error
  and left unparsed rather than parsed wrongly.

### Link classes

Step 8 puts exactly one class on every `<a href>`; the site only styles them.

| class | meaning | mark |
| --- | --- | --- |
| `link-external` | somewhere else on the web | `↗` |
| `link-kept` | old-site target we hold, repointed at our copy | green dot |
| `link-lost` | old-site target we never recovered | red dot |

Styled in `site/src/pages/Thread/Thread.scss`; the `--kept` / `--lost` colour
tokens are the only colour on an otherwise monochrome site
(`site/src/styles.scss`).

## Cache invalidation — three separate version hashes

Each is a hash that invalidates derived data when the code that produced it
changes. They differ in what they hash, and that difference matters enormously.

| where | hashes | cost when it changes |
| --- | --- | --- |
| `parserVersion()` in `src/006_parseNodes.js` | `lib/generations.js` **+ its own whole source** | re-parses all 62k nodes from archive HTML — very expensive |
| `cleanerVersion()` in `src/008_cleanHtml.js` | `lib/assets.js` + its own whole source | re-cleans all 62k threads, ~4 min |
| `summaryVersion()` in `src/lib/summary.js` | **only `summarise.toString()`** | re-reads all 62k YAMLs, ~60 s |

**Trap:** editing `src/006_parseNodes.js` at all — even a comment — re-parses
the entire corpus from archive HTML. This is why the thread index went into its
own step 9 rather than into step 6. Be deliberate about touching that file.

`summaryVersion()` hashes only the function because hashing a whole module
means unrelated edits throw away the derived data; that bug existed in
`site/lib/data.mjs` and was fixed. Prefer this pattern for new version hashes.

### Why step 9 exists

Step 8 rewrites every thread file, so anything keyed on a file's size or mtime
is invalidated by every cleaning pass. Step 9 keys each summary on the capture
fingerprint step 6 recorded (`fp` + `parser` from `data/parsed/state.json`),
which cleaning cannot change — so a cleaning pass leaves the whole index
standing. **Do not re-key it on mtime.** Verified: touching 50 thread files
causes zero re-reads.

## The site

- `site/lib/routes.mjs` is the single definition of URL shapes, shared by the
  dev server and the static build, so a route cannot work in dev and 404 in
  production.
- `resolve(route, getIndex)` in `site/lib/resolve.mjs` takes the index as a
  **function**. Only listing routes call it; a thread page must never build the
  index. Keep it lazy.
- `buildIndex()` in `site/lib/data.mjs` prefers `nodes/_index.jsonl`, falling
  back to scanning every YAML into `site/.cache/index.json` when step 9 has not
  run. The fallback is correct but ~60 s cold and mtime-keyed. It is memoised
  in-process; a hand-edit of one YAML needs a dev-server restart.
- `src/lib/summary.js` is imported by **both** packages —
  `site/lib/data.mjs` reaches across with a relative path. This works under
  Vite and Node. Changing `summarise()` requires re-running step 9.

Measured after the current design: index 125 ms cold / 0 ms warm, thread page
~40 ms.

## Conventions

- ESM throughout (`"type": "module"`), two-space indent, double quotes.
- Steps are numbered `NNN_name.js` and are driver scripts; genuinely shared
  helpers live in `src/lib/`. `config.js` and `util.js` are used by every step.
- Comments explain **why**, in prose, and are unusually thorough — match that
  register. They use `--` rather than em dashes. No emoji anywhere.
- Every step is incremental and re-runnable, writes atomically (`.part` then
  rename), and reports totals for the **whole corpus**, not just the increment.
- Counts print through `formatCount`, aligned with dot leaders.

## Known problems

- **`.gitignore` is corrupted** (committed that way). Lines 17–30 are a mangled
  duplication of lines 8–14 and contain two nonsense paths,
  `data/parsed/users/_profiles.json.log` and `…_profiles.json.meta.json`. The
  intended negations for `parse.log` and `parse.meta.json` do survive at lines
  15–16, so the behaviour is roughly right, but the file should be rewritten.
- **`README.md` is partly stale.** It still describes ~11,227 threads (now
  62,469), a `site/lib/sanitize.mjs` that no longer exists (that work is step
  8), says embedded images "will not load" (step 8 now points them at our
  copies), lists post-processing the HTML as still to do (done), and does not
  mention steps 8 or 9.
- **Repository size.** `data/parsed` (3.5 GB, including 2.7 GB of binary files)
  is committed so the GitHub Action can build without re-downloading. Any
  change that rewrites every thread YAML adds another full copy to git history,
  permanently. Weigh this before changing step 6 or 8 output formatting.

## Publishing

`.github/workflows/pages.yml` builds and publishes to
**typophile.signalwerk.ch** on every push to `main` touching `data/parsed/**`
or `site/**`.
