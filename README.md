# archive.typophile.com

Pull the last living version of every typophile.com URL out of every web
archive we can reach, then parse it.

Typophile went dark in **2015**. The archives still hold plenty of captures
after that date, but they are all placeholder pages (a reboot notice, then
"Site off-line", then a parked domain). So the job is not "download the newest
capture" but "download the newest capture from *before* the site died".

## Archives

| archive | how the index is read | how content is fetched |
| --- | --- | --- |
| `web.archive.org` | paged CDX (~160 pages) | replay with the `id_` modifier |
| `arquivo.pt` | one CDX request, JSON lines | replay with the `id_` modifier |
| `commoncrawl.org` | one index per monthly crawl (127 of them) | HTTP range request into the WARC file |

Each archive keeps its own folder with its **exact capture metadata**
preserved, so the three can be compared and merged later.

## Running it

```sh
sh get.sh                        # all archives
sh get.sh --archive=arquivo.pt   # just one
sh get.sh --concurrency=6
```

Every step is resumable and safe to re-run. Nothing that is already correct on
disk gets fetched twice, so you can interrupt with `Ctrl-C` at any point and
start again where you left off.

Steps can also be run on their own. The archive collection steps (0–4) take
`--archive=`:

| step | command | what it does |
| --- | --- | --- |
| 0 | `npm run index` | fetch each archive's capture index |
| 1 | `npm run cutoff` | find the timestamp at which the site went offline |
| 2 | `npm run latest` | keep the newest good capture of every URL, per archive |
| 3 | `npm run list` | turn those into download jobs with local target paths |
| 4 | `npm run download` | download whatever is missing or outdated |
| 5 | `npm run select` | choose the best archived copy of every `/node/` page |
| 6 | `npm run parse` | parse the selected pages into one YAML per node |
| 7 | `npm run users` | build member records from the recovered bylines |
| 8 | `npm run clean` | derive cleaned HTML and repoint links at recovered files |
| 9 | `npm run threads` | build the compact thread listing index |
| 10 | `npm run old-urls` | match pre-Drupal discussion URLs to their node IDs |
| 11 | `npm run old-messages` | parse unmatched old discussions into a separate corpus |

## What step 0 re-fetches

Nothing it already has. Index pages, per-crawl page files and arquivo.pt's
whole response are kept on disk and skipped on later runs, and the two lookups
that used to happen every time — the Wayback page count and Common Crawl's
crawl list — are cached beside them:

```
   page count: from cache (1m old) -- pass --refresh to re-check
160 index pages
pages fetched: 0, already on disk: 160
```

A re-run with everything present makes **no network request at all** (0.05s,
against 2.3s before the cache).

| flag | effect |
| --- | --- |
| *(none)* | use everything already on disk |
| `--refresh` | re-check the page count and crawl list for new captures; still keeps downloaded pages |
| `--force` | re-fetch everything |

Only one index fetch or download per archive can run at a time; a second one
says so and exits rather than corrupting the first's state.

## How "already downloaded" is decided

All three archives publish a `digest` for every capture: the SHA-1 of the
response payload, in base32. We retrieve exactly the bytes that digest
describes — the *original* capture, not a rewritten replay page — so the check
is exact rather than a guess.

For each URL:

1. If the state file says this exact file was verified and its size and mtime
   are unchanged, skip it.
2. Otherwise, if the file exists, hash it. If the digest matches, skip it and
   record that. (This is what rescues you when the state file is lost — the
   files on disk are enough.)
3. Otherwise, download it, verify the digest, and write it atomically.

So a file is only re-fetched when it is genuinely missing, truncated, or not
the capture the index points at. **Correct data on disk is never re-downloaded
and never overwritten.**

Because the digest format is identical across all three archives, the *same*
digest means the *same* bytes everywhere — which is what the eventual merge
step will use to tell duplicates from genuinely different captures.

### Downloader flags

```
--archive=ID      one archive, or `all` (default)
--concurrency=N   parallel downloads (default 4)
--limit=N         only process the first N jobs
--dry-run         report what would happen, fetch nothing
--verify          re-hash every existing file instead of trusting the cache
--skip-failed     don't retry captures that failed before
```

## The cutoff is global, on purpose

Step 1 detects when the site died and writes one cutoff used by **every**
archive. This matters: arquivo.pt's own captures of the placeholder pages only
start in 2019, so a per-archive cutoff would happily keep all of its dead 2018
captures. The evidence from archive.org protects the other archives.

Step 1 prints what it used, so the date can be checked:

```
=== Internet Archive Wayback Machine ===
       24x  2015-05-01 08:01 .. 2015-09-08 10:25  Typophile turned 15 years old ...
       33x  2016-01-11 18:59 .. 2016-06-18 21:49  Site off-line

=== global cutoff ===
   20150501080143 (2015-05-01 08:01)
```

The placeholder checksums live in `OFFLINE_HASHES` in
[src/lib/config.js](src/lib/config.js). If a placeholder is missed, add its
checksum there. To bypass detection entirely, set `CUTOFF_OVERRIDE`.

## Filtering what gets downloaded

By default every URL is downloaded. Step 3 can narrow that:

```sh
node src/003_downloadList.js --include='/node/[0-9]+$' --mime=text/html
node src/003_downloadList.js --exclude='\.(css|js|swf|gif)$'
node src/003_downloadList.js --archive=commoncrawl.org --limit=1000
```

## Layout

```
data/
  cutoff.json                    global offline date + the evidence for it
  archives/
    web.archive.org/
      raw/                       the index exactly as the archive served it
      index/latest.jsonl         one line per URL: the capture we want
      index/downloads.jsonl      the same, plus local path and how to fetch it
      files/typophile.com/...    the downloaded originals
      state/downloads.jsonl      what is on disk and verified
      state/failures.jsonl       captures that could not be fetched or verified
    arquivo.pt/                  same layout
    commoncrawl.org/             same layout
```

Local paths come from the CDX url key, so `/node/3687` lands at
`files/typophile.com/node/3687.html`. An extension is only added when the URL
has none, query strings become a `__q_` suffix, and the rare case of two URLs
normalising onto one filename is resolved with a short hash. Directory segments
give up their dots (`/index.php/member/register` becomes
`index%2Ephp/member/register.html`) so that a path can never be a file and a
folder at once. The same URL gets the same relative path in every archive,
which makes the archives directly comparable.

## Archive quirks worth knowing

- **web.archive.org** replays the *original* `Content-Encoding: gzip` header on
  bodies that are not actually gzipped, so anything that auto-decompresses
  fails. It also substitutes a neighbouring capture when the exact timestamp
  cannot be replayed — only the digest check catches that.
  Its `showNumPages=true` must not be combined with `fl=`, or it answers with a
  row of dashes instead of the page count.
  Some stored records are damaged: the original was gzip-encoded and `id_`
  serves decompressed bytes cut off at the *compressed* `Content-Length`, so the
  HTML stops mid-tag and can never match its digest. For those the downloader
  falls back to the ordinary rewritten replay, which returns the whole page, and
  records `verified: false, source: "rewritten"` — complete, but URL-rewritten
  and not byte-verifiable, so the merge step should prefer a verified capture
  from another archive when one exists.
- **arquivo.pt** only verifies through `/wayback/<ts>id_/`. Its
  `/noFrame/replay/` and plain `/wayback/<ts>/` endpoints return rewritten
  pages. Its useful coverage is small (~157 pre-cutoff URLs, mostly images).
- **commoncrawl.org** has no replay service at all; content comes from a byte
  range inside the crawl's WARC file. The record block is exactly
  `Content-Length` bytes — the trailing `\r\n\r\n` separator must not be
  included or the digest will not match. Many records carry
  `WARC-Truncated: length`, meaning the content is **incomplete**; that is
  recorded in `state/downloads.jsonl` so the merge step can prefer a complete
  capture from another archive. The index server also 504s on broad queries,
  so crawls are fetched one at a time and retried.

## Parsing the forum threads

Steps 5 and 6 turn the downloaded `/node/<id>` pages into one YAML file each.

```sh
npm run select   # pick which archived copy of each node to parse
npm run parse    # parse those into data/parsed/nodes/<id>.yaml
```

### Which copy gets parsed

Step 5 looks at all three archives and takes the **latest** capture of each
node — with one exception. A capture Common Crawl marked `WARC-Truncated` is
cut off mid-document, so a complete older copy beats a truncated newer one.
Every such swap is counted, and `--prefer-latest` turns the exception off.

### Generations

The content survived Typophile's redesigns but the HTML around it did not, so
each page is matched to a parser for its era. Detection is by structure, not by
date:

| generation | markers | byline | comments | date format |
| --- | --- | --- | --- | --- |
| `sidebars` | `body.sidebars`, `div#node-<id>` | `.content-head .submitted` | `#comments` → `a#comment-<id>` + `div.comment` | `20 Oct 2003 — 11:32am` |
| `classic` | `#content-frame`, `div.node > .info` | `.info` | `a#comment-<id>` + `div.comment` | `24.Jan.2004 6.23pm` |

A page matching **no** generation is never guessed at — it is reported as an
error in the log and left unparsed. New generations go in
[src/lib/generations.js](src/lib/generations.js): add a `detect` and a `parse`,
and the rest of the pipeline picks it up.

### Output

One file per node, with the HTML of the post and of every comment kept exactly
as it appeared — nothing rewritten or stripped:

```yaml
node: 109
title: Bertrand
old_url: http://www.typophile.com/forums/messages/29/10687.html
forum: { id: 27, title: Serif }
source:
  archive: commoncrawl.org
  timestamp: "20150426213756"
  captured_at: "2015-04-26T21:37:56Z"
  url: http://typophile.com/node/109
  digest: 45MBTOIXTI2W5Q2M3F4MXBTHZTERMLIA
  verified: true
  truncated: false
  generation: sidebars
post:
  id: 109
  user_id: 1275
  user_name: jfp
  date: "2003-05-12T07:47:00"
  date_raw: 12 May 2003 — 7:47am
  votes: null
  html: |
    <p>…</p>
comments:
  - id: 351
    user_id: 1250
    …
```

`date` is deliberately naive: no timezone appears anywhere on the page, so
inventing one would be a lie. `date_raw` keeps the original string.

`votes` is `null` throughout — neither surviving generation renders a score.
The extraction hook is in place should a generation that does turn up.

`user_path` appears when a member had a vanity profile URL (`/readthetype`)
instead of a numeric one: there is no id to recover, but the name and path are.

### Re-running after new material arrives

Steps 5 and 6 are incremental. Step 5 re-examines every archive and prints what
moved since last time:

```
since the last run:
   new nodes ........ 1,204
   changed copy ..... 37
   unchanged ........ 11,190
```

Step 6 then re-parses only the new and changed ones. The decision is made on a
**fingerprint** covering everything that could change the result — archive,
timestamp, digest, local file, size, and whether the capture is a whole
document. Comparing the timestamp alone is not enough: the same capture can be
re-downloaded and yield different bytes (a damaged Wayback record replaced by
the complete rewritten replay keeps its original timestamp), and that has to
count as changed.

`data/parsed/state.json` records, per node, that fingerprint, the parser
version, and any findings. It is the authority for skipping — a node can only
be skipped if its findings can be replayed, so **the log always describes the
whole corpus rather than just the last increment**. Deleting the state file is
safe; it just forces a full re-parse. Each YAML also carries its own
`fingerprint:` and `parser:` in the `source:` block, for inspection.

Editing the parsers invalidates the output automatically: step 6 hashes
`generations.js` together with its own source, and re-parses anything built by
a different version. No `--force` needed after a parser fix — that flag is only
for re-parsing something that has not changed.

### Which captures count as whole

A later capture of a thread carries more replies, so **latest wins** among
captures that are whole documents. A capture is *not* whole when:

- the archive recorded it as truncated (Common Crawl's `WARC-Truncated`), or
- its bytes did not match the digest and no better copy was found — on the
  Wayback Machine that usually means a damaged record whose HTML stops mid-tag.

A capture recovered through the rewritten replay **is** whole — it just cannot
be byte-verified — so it stays eligible. `--prefer-latest` ignores all of this
and takes the newest capture regardless.

### The parse log

`data/parsed/parse.log` holds **only** warnings and errors — a clean run leaves
it empty:

```
WARN  node 94      source capture is truncated (commoncrawl.org 20150418114616) -- content may be incomplete
WARN  node 16534   comment.user_id (comment 333616): no user id (author "Chris Dean")
ERROR node 13987   post.html: empty post body
```

Counts land in `data/parsed/parse.meta.json`.

### Matching the pre-Drupal thread URLs

Before `/node/<id>`, Typophile used Discus URLs shaped like
`/forums/messages/<forum-id>/<thread-id>.html`. The migration assigned new,
unrelated node IDs. Step 10 parses those recovered pages and matches them by
decoded title and the local timestamp of the first post. When those collide,
it uses the preserved opening-post body and reply count; a match that remains
ambiguous is logged and not guessed.

A successful match adds the canonical absolute address as `old_url` beside the
node title. `data/parsed/old-urls.log` lists recovered old discussions that
could not be assigned to a captured node as `MISSING`; these may have been
dropped during migration, or their modern page may simply be absent from our
captures. Genuine multiple-node matches are listed as `AMBIGUOUS`. Modern
nodes without an old counterpart are deliberately not logged.

Step 11 parses those `MISSING` discussions into
`data/parsed/messages/<forum-id>-<old-message-id>.yaml`. They use the same raw
thread shape as step 6 output but stay separate from Drupal nodes. Both legacy
ids are part of the filename because ten message ids survive under multiple
forum paths; each URL remains a distinct file rather than colliding.

Archived query-string snapshots are merged by Discus post id rather than
choosing only one capture. This matters because later snapshots sometimes omit
posts visible in earlier ones. The newest observation wins for edited posts,
while older-only posts remain. Snapshots are merged only when they belong to
the exact same forum/message URL; moved-forum aliases are not merged. The
current corpus contains 1,029 files and 6,923 recovered posts and replies from
1,279 parseable snapshots.
These files contain preserved raw `html`; step 8 and the site do not yet read
the separate `messages/` corpus.

Each run reconstructs `messages/` from the current step-10 `MISSING` set in a
staging directory and publishes it only when complete. If a later archive run
recovers a Drupal node and step 10 can match it, its legacy-only YAML is
therefore removed on the next step-11 run.

Step 11 learns author mappings from discussions that step 10 matched to Drupal
nodes. The opening posts are paired by that established thread relation;
replies are paired only when their local timestamp and normalised body both
match exactly. A Discus identity is replaced with a Drupal user id only when
all migrated-post evidence points to one existing user. Display-name similarity
is never treated as a match.

Identities without migrated-post evidence remain stable string ids and are
listed once each as `UNRESOLVED_USER` in `messages.log`. Evidence pointing to
multiple Drupal users is left unchanged and listed as `AMBIGUOUS_USER` with the
candidate ids. Each line also includes the old profile key, observed names,
entry count, and discussion count. The current corpus resolves 537 identities
covering 5,878 entries; 412 identities covering 873 entries are unresolved,
and five identities covering 172 entries are ambiguous.

## The site

A Vite + React generator in [site/](site/) turns the parsed YAML into static
HTML — no client-side JavaScript beyond the stylesheet.

```sh
cd site
npm install
npm run dev      # http://localhost:5173
npm run build    # -> site/dist
```

### Dev renders one page, not eleven thousand

The dev server renders per request. Only the page you ask for is built, and
only that thread's YAML is read. The listing pages need a summary per thread,
so those summaries are cached in `site/.cache/index.json` and re-read only for
files whose size or mtime changed:

```
first build   8.3s     (11,227 threads)
cached        0.07s
page request  0.08s
```

Editing one thread's YAML costs one re-read. Editing a component goes through
Vite's normal HMR and touches no data at all.

The full static build is separate: `npm run build` renders every route —
11,442 pages in about 11 seconds.

### Routes

| route | page |
| --- | --- |
| `/`, `/page/<n>/` | all threads, newest activity first, 100 per page |
| `/forum/<id>/`, `/forum/<id>/page/<n>/` | one forum |
| `/node/<id>/` | a thread: opening post then every comment |

`lib/routes.mjs` is the single definition of these shapes, shared by the dev
server and the build, so a route cannot work in dev and 404 in production.

### Archived HTML

Post and comment HTML is rendered as captured. Before it goes into a page,
`lib/sanitize.mjs` drops the parts that execute or phone home — `script`,
`style`, `iframe`, `object`, `embed`, `form`, inline `on*` handlers and
`javascript:` URLs. Everything structural is left alone. Images still point at
typophile.com and will not load; that is the archive being honest about what it
has.

## Publishing

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the site
and publishes it to **typophile.signalwerk.ch** on every push to `main` that
touches `data/parsed/**` or `site/**`.

For that to work the parsed YAML is committed to the repository — that is why
`.gitignore` lets `data/parsed/nodes/` through while keeping the raw archive
material (tens of gigabytes, and reproducible) out.

One-time setup in the repository settings: **Settings → Pages → Source →
GitHub Actions**, and point a `CNAME` DNS record for `typophile` at
`signalwerk.github.io`. The build writes the `CNAME` file itself.

> **A note on repository size.** The parsed YAML is ~56 MB (~17 MB packed) for
> the 11k threads recovered so far. Because a parser change rewrites every
> file, each such commit adds another full copy to git history permanently. If
> the archive.org download multiplies the thread count, consider committing the
> data as a single compressed archive, or moving it to Git LFS.

## Still to do

- **Combine the archives** for everything other than `/node/` pages.
- Post-process the stored HTML (the pipeline keeps it verbatim on purpose).
