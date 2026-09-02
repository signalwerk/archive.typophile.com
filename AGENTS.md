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

Typophile, a typography discussion board, went offline temporarily in 2015,
returned in late 2016, and entered its final outage in 2019. This project
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
| threads | 66,630 (`data/parsed/nodes/<id>.yaml`) |
| comments | 412,434 |
| members | 28,614 files, 28,610 with numeric ids |
| embedded files | 29,041 (`data/parsed/files/`, 2.8 GB) |
| interface files | 1 (`data/parsed/misc/`) |
| legacy-only discussions | 1,111 (`data/parsed/messages/<forum-id>-<old-id>.yaml`), 8,406 posts |
| `data/parsed` total | 3.8 GB |

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
| 10 | `npm run old-urls` | match Discus URLs to nodes; write `old_url` + `old-urls.log` | ~20 s |
| 11 | `npm run old-messages` | parse unmatched Discus threads and map migrated authors | ~20 s |
| 12 | `npm run special-files` | copy recovered interface files that no post pulls in | |

Site, from `site/`: `npm run dev` (port 5173) and `npm run build`. The build
renders all ~65k routes every time — there is no incremental build — and then
copies the 2.5 GB of embedded files into `dist/`. Rendering itself is cheap
(~1 ms/page, measured); the copy is not. Time it before assuming.

## Architecture

```
archives ──0-4──> data/archives/<archive>/files/<timestamp>/<host>/…
                                                        raw captures, digest-verified
             5-6──> data/parsed/nodes/<id>.yaml         one thread per file
               7──> data/parsed/users/<id>.yaml + _index.jsonl
               8──> html_clean written into each thread YAML
               9──> data/parsed/nodes/_index.jsonl      one summary line per thread
                     │
                     └──> site/  reads the two _index.jsonl files and one YAML per page
              10──> old_url added to matched thread YAML + data/parsed/old-urls.log
              11──> data/parsed/messages/<forum-id>-<old-id>.yaml   legacy-only corpus
              12──> data/parsed/misc/id_generic.gif                shared avatar fallback
```

### Legacy thread URLs

Before Drupal, discussion URLs were
`/forums/messages/<forum-id>/<thread-id>.html`; those numbers have no numeric
relationship to the later `/node/<id>`. Step 10 parses the downloaded Discus
pages and joins them on decoded title + the first post's naive local timestamp.
For collisions or damaged titles it also compares the preserved first-post
body and reply count. It never assigns an ambiguous match.

The canonical absolute address is stored as top-level `old_url` in the node
YAML. `data/parsed/old-urls.log` is intentionally legacy-centric: `MISSING`
means a recovered old discussion has no matching captured node (it may not
have migrated, or the new page may simply be absent from our captures), and
`AMBIGUOUS` records multiple plausible nodes. It does not list modern nodes
without old counterparts. Multiple query-string captures of one Discus URL
are collapsed to the snapshot with the most posts. Step 10 depends on the step
9 index for the cheap title/date side of the join, but changing `old_url` does
not invalidate that index because the summary shape does not include it.

Verified on the current corpus: 14,023 legacy HTML files contain 4,530 thread
snapshots representing 3,137 distinct old discussion URLs. Of those, 2,006
modern nodes match uniquely, with 17 old moved-forum aliases folded onto their
newest captured location; 1,111 old discussions are `MISSING`, and one is
`AMBIGUOUS`. The earliest 58 discussions use malformed single-hyphen Discus
markers (`<!-Post...-!>`) and are parsed alongside the later proper comments.

Step 11 consumes only the `MISSING` lines and writes the ordinary raw thread
shape (`node`, `title`, `old_url`, `forum`, `source`, `pages`, `post`, and
`comments`) to `data/parsed/messages/<forum-id>-<old-message-id>.yaml`. Both ids
are required: ten message ids survive at two forum paths, and every one of the
1,111 old URLs must remain distinct. Query-string captures of the exact same
forum/message URL are merged by Discus post id because later pages sometimes
omit posts visible in earlier captures; the newest observation of an edited
post wins. Moved-forum aliases are not merged. `source.content` says `merged
snapshots` when this happened and `source.snapshots` records how many captures
contributed. The current corpus merges 1,446 parseable snapshots into 8,406
recovered entries (1,111 opening posts and 7,295 replies).

Step 11 reconstructs the complete `messages/` directory in `messages.part/`
and swaps it into place only after processing the current `MISSING` set. It
copies fingerprint-current files into the staging directory, so it remains
incremental. This full-directory publication is important: after a later
archive run recovers a matching Drupal node, the no-longer-missing legacy YAML
must disappear rather than linger in `messages/`.

These files deliberately contain raw `html` but no `html_clean`: they have the
same shape as step 6 output and are not yet a site input, while step 8 remains
scoped to `parsed/nodes/`. Old Discus profiles had no Drupal numeric user id;
the `user` field therefore uses the stable slug of the old profile key (or the
display name when there was no profile link), just as regular guest/vanity
authors use string ids. Step 11 learns the old-to-new author relation from the
2,006 discussions already matched to nodes: opening posts align through the
thread relation, while replies require an exact naive timestamp + normalised
body match. It accepts an identity only when all evidence points to one id that
exists in `users/_index.jsonl`; it never guesses from a display name. Conflicts
remain legacy string ids and are logged as `AMBIGUOUS_USER`; identities with no
migrated-post evidence are `UNRESOLVED_USER`. Log lines include the old profile
key, names, candidate ids, entry count, and discussion count.

The resolver currently learns 1,419 unambiguous mappings from 19,727 migrated
posts. In the legacy-only corpus this resolves 566 identities / 7,207 entries;
476 identities / 1,023 entries remain unresolved and four identities / 176
entries are ambiguous. The mapping plus user-index content hash is part of each
message fingerprint, so newly captured matched nodes or a changed user index
invalidate affected output. `messages.meta.json` holds the totals.

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

## Cache invalidation — five separate version hashes

Each is a hash that invalidates derived data when the code that produced it
changes. They differ in what they hash, and that difference matters enormously.

| where | hashes | cost when it changes |
| --- | --- | --- |
| `parserVersion()` in `src/006_parseNodes.js` | `lib/generations.js` **+ its own whole source** | re-parses all 65k nodes from archive HTML — very expensive |
| `profileParserVersion()` in `src/007_users.js` | `lib/userProfile.js` | re-parses the downloaded `/user/` profile pages |
| `cleanerVersion()` in `src/008_cleanHtml.js` | `lib/assets.js` + its own whole source | re-cleans all 65k threads, ~4 min |
| `summaryVersion()` in `src/lib/summary.js` | **only `summarise.toString()`** | re-reads all 65k YAMLs, ~60 s |
| `parserVersion()` in `src/011_oldMessages.js` | `lib/legacyThreads.js` + its own whole source | re-parses 1,111 legacy-only discussions after rebuilding the author map |

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

Parser versions and capture fingerprints are cache state, not published thread
content. They live in `data/parsed/state.json` and
`data/parsed/messages-state.json`; node and legacy-message YAML deliberately
omit them. Do not add them back to `source`: doing so makes every parser or
resolver change dirty the whole corpus in Git even when the parsed content is
otherwise byte-identical. The archive, timestamp, digest and source file remain
in each YAML for provenance.

Step 6 has three explicitly detected HTML generations. `classic` handles the
early `#content-frame` pages, `sidebars` handles the pre-outage theme with
`div#node-*`, and `drupal7` handles the site returned after the 2016 reboot.
The last of these has both ordinary `article#node-*` markup (including wiki,
font-id, type-id, blog and some forum nodes) and Advanced Forum
`div#post-*.forum-post` markup. Drupal's body class `no-sidebars` is not the
older `sidebars` generation: detectors must compare complete class tokens,
not search for `sidebars` as a substring. Wiki pages intentionally omit a
byline but still produce a post containing their body.

The live step 5 is `src/005_selectNodes.js`; parsing is step 6, and its
generation-specific implementations belong in `src/lib/generations.js`. Step
5 only selects captures; do not introduce a competing parser there.

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

Members without a recovered picture use Typophile's original shared
`/misc/id_generic.gif` placeholder. The parser deliberately treats that URL as
no per-user avatar; step 12 copies the verified capture to
`data/parsed/misc/id_generic.gif`, which retains its original
`/misc/id_generic.gif` address. Avatar styling adds neither a background nor a
border.

The cutoff is the start of the **final** outage, not the first time the site was
unavailable. Verified from captures: the reboot notice replaced the forum from
May 2015, `Site off-line` responses continued through June 2016, the real
Drupal site returned in December 2016 and was still live on 11 October 2019,
then the terminal maintenance page appeared on 23 October 2019. Step 1 records
all placeholder eras but derives the cutoff only from hashes listed in
`TERMINAL_OFFLINE_HASHES`. Step 2 independently rejects every known placeholder
digest before that date, plus known same-origin error payloads in
`BAD_PAGE_HASHES`; this lets it select good captures on either side of a
temporary outage. In particular, `/files/img-thing_5442.jpg` is an ordinary
2016 asset, not a special case.

Downloaded archive files are timestamp-first:
`data/archives/<archive>/files/<14-digit timestamp>/<host>/<path>`. Both the
step 3 job `file` and the archive-state `f` field contain that timestamp.
Consumers matching the URL-shaped portion must call `captureUrlPath()` rather
than assume the host is the first path component. The timestamp layer was
added to permit multiple versions later; steps 2--4 still select, list and
store only one chosen capture per URL, and download state is still keyed by
the URL key `k`. Existing captures were migrated in place with no network
download; the one-off migration script was deliberately not retained.

## Conventions

- ESM throughout (`"type": "module"`), two-space indent, double quotes.
- Steps are numbered `NNN_name.js` and are driver scripts; genuinely shared
  helpers live in `src/lib/`. `config.js` and `util.js` are used by every step.
- Comments explain **why**, in prose, and are unusually thorough — match that
  register. They use `--` rather than em dashes. No emoji anywhere.
- Every step is incremental and re-runnable, writes atomically (`.part` then
  rename), and reports totals for the **whole corpus**, not just the increment.
  Step 6 must therefore reconstruct its multi-page and incomplete-thread
  counts when it reuses parser state, just as it replays cached findings.
- Numeric profile links appeared as `/user/<id>`, relative `user/<id>`, and the
  short-lived `/cms/user/<id>` route; all must resolve to the same numeric user.
  Wayback-wrapped vanity links must be reduced to their original Typophile
  path. `/readthetype` is a verified alias of user 15065: the archived vanity
  profile's login form names `user/15065` and both profile forms use
  `picture-15065.jpg`. Four non-numeric users remain in the current corpus:
  `guest` is a synthetic bucket for bylines with no profile link, not one
  identifiable person, while `jackieki-not-verified`, `alaskan-not-verified`
  and `gandalf-not-verified` are literal archived bylines with no numeric
  profile evidence. Step 7 prunes user YAML and copied pictures that disappear
  after this normalization.
- Counts print through `formatCount`, aligned with dot leaders.

## Known problems

- **`README.md` is partly stale.** It still describes ~11,227 threads (now
  66,630), a `site/lib/sanitize.mjs` that no longer exists (that work is step
  8), says embedded images "will not load" (step 8 now points them at our
  copies), and lists post-processing the HTML as still to do (done).
- **Repository size.** `data/parsed` (3.8 GB, including 2.8 GB of binary files)
  is committed so the GitHub Action can build without re-downloading. Any
  change that rewrites every thread YAML adds another full copy to git history,
  permanently. Weigh this before changing step 6 or 8 output formatting.

## Publishing

`.github/workflows/pages.yml` builds and publishes to
**typophile.signalwerk.ch** on every push to `main` touching `data/parsed/**`
or `site/**`.
