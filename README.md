# archive.typophile.com

Pull the last living version of every typophile.com URL out of the Wayback
Machine, then parse it.

Typophile went dark in 2015. The Wayback Machine still holds many captures
after that date, but they are all placeholder pages ("Site off-line", a reboot
notice, a parked domain). So the job is not "download the newest capture" but
"download the newest capture from *before* the site died".

## Running it

```sh
sh get.sh
```

Every step is resumable and safe to re-run. Nothing that is already correct on
disk gets fetched twice, so you can interrupt with `Ctrl-C` at any point and
start again where you left off.

Flags are passed through to the downloader:

```sh
sh get.sh --concurrency=6
```

Steps can also be run on their own:

| step | command | what it does |
| --- | --- | --- |
| 0 | `npm run cdx` | fetch the CDX index for `*.typophile.com`, one page at a time |
| 1 | `npm run cutoff` | find the timestamp at which the site went offline |
| 2 | `npm run latest` | keep the newest good capture of every URL |
| 3 | `npm run list` | turn those into download jobs with local target paths |
| 4 | `npm run download` | download whatever is missing or outdated |

## How "already downloaded" is decided

The CDX index gives a `digest` for every capture: the SHA-1 of the original
response body, in base32. We request the *original* capture from the Wayback
Machine (the `id_` modifier) rather than the rewritten replay page, so the
bytes we receive are exactly the bytes that digest describes.

That makes the check exact rather than a guess. For each URL:

1. If the state file says this exact file was verified and its size and mtime
   are unchanged, skip it.
2. Otherwise, if the file exists, hash it. If the digest matches, skip it and
   record that. (This is what rescues you when the state file is lost — the
   files on disk are enough.)
3. Otherwise, download it, verify the digest, and write it atomically.

So a file is only re-fetched when it is genuinely missing, truncated, or not
the capture the index points at. **Correct data on disk is never re-downloaded
and never overwritten.**

A handful of captures cannot be replayed exactly and the Wayback Machine
substitutes a neighbouring snapshot. Those are still written to disk (they are
real captures) but recorded in `data/state/failures.jsonl` and retried on the
next run. Use `npm run download -- --skip-failed` to stop retrying them.

### Downloader flags

```
--concurrency=N   parallel downloads (default 4)
--limit=N         only process the first N jobs
--dry-run         report what would happen, fetch nothing
--verify          re-hash every existing file instead of trusting the cache
--skip-failed     don't retry captures that failed before
```

## Filtering what gets downloaded

By default every URL is downloaded. Step 3 can narrow that:

```sh
node src/003_downloadList.js --include='/node/[0-9]+$' --mime=text/html
node src/003_downloadList.js --exclude='\.(css|js|swf|gif)$'
node src/003_downloadList.js --limit=1000
```

## Layout

```
data/
  cdx/
    pages/page-0000.cdx     one file per CDX page, re-used on later runs
    typophile.com.cdx       all pages concatenated
    meta.json
  index/
    001_cutoff.json         detected offline date + the evidence for it
    002_latest.jsonl        one line per URL: the capture we want
    003_downloads.jsonl     the same, plus replay URL and local path
  files/
    typophile.com/...       the downloaded originals
  state/
    downloads.jsonl         what is on disk and verified
    failures.jsonl          captures that could not be fetched or verified
```

Local paths come from the CDX url key, so `/node/3687` lands at
`data/files/typophile.com/node/3687.html`. An extension is only added when the
URL has none, query strings become a `__q_` suffix, and the rare case of two
URLs normalising onto one filename is resolved with a short hash.

## Checking the cutoff

Step 1 prints the evidence it used, so the date can be sanity-checked:

```
placeholder captures found:
       24x  2015-05-01 08:01 .. 2015-09-08 10:25  Typophile turned 15 years old ...
        4x  2015-09-10 12:07 .. 2015-10-26 10:31  Site off-line
       35x  2019-10-23 23:13 .. 2020-10-19 15:26  Typophile is temporarily down ...

cutoff: 20150501080143 (2015-05-01 08:01)
```

The placeholder checksums live in `OFFLINE_HASHES` in
[src/lib/config.js](src/lib/config.js). If a placeholder is missed, add its
checksum there. To bypass the detection entirely, set `CUTOFF_OVERRIDE`.

## Step 2: parsing

`src/005_parse.js` still expects the old paths and the old download-list shape,
so it needs updating before it will run against this pipeline.

## Notes

- [Using the Wayback Machine — specific archive copy](https://en.wikipedia.org/wiki/Help:Using_the_Wayback_Machine#Specific_archive_copy)
- Special version later: `https://web.archive.org/web/20170808195650/http://www.typophile.com/user/197175`
- Old version: `http://typophile.com:80/cms/node/10435`
- Node 10 >>> poll!
