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

Steps can also be run on their own — all of them take `--archive=`:

| step | command | what it does |
| --- | --- | --- |
| 0 | `npm run index` | fetch each archive's capture index |
| 1 | `npm run cutoff` | find the timestamp at which the site went offline |
| 2 | `npm run latest` | keep the newest good capture of every URL, per archive |
| 3 | `npm run list` | turn those into download jobs with local target paths |
| 4 | `npm run download` | download whatever is missing or outdated |

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
normalising onto one filename is resolved with a short hash. The same URL gets
the same relative path in every archive, which makes the archives directly
comparable.

## Archive quirks worth knowing

- **web.archive.org** replays the *original* `Content-Encoding: gzip` header on
  bodies that are not actually gzipped, so anything that auto-decompresses
  fails. It also substitutes a neighbouring capture when the exact timestamp
  cannot be replayed — only the digest check catches that.
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

## Still to do

- **Combine the archives** into one merged set, preferring complete captures
  over truncated ones and the newest pre-cutoff capture across archives.
- `src/005_parse.js` still expects the old single-archive paths and the old
  download-list shape, so it needs updating before it will run.
