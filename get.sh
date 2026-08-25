#!/bin/sh
# Fetch the last living version of typophile.com from every archive we can reach.
#
# Archives covered:
#   web.archive.org   Internet Archive Wayback Machine
#   arquivo.pt        Arquivo.pt (Portuguese Web Archive)
#   commoncrawl.org   Common Crawl
#
# Every step is resumable and safe to re-run: nothing already correct on disk
# is fetched twice. Interrupt with Ctrl-C whenever you like and start again.
#
#   sh get.sh                        all archives
#   sh get.sh --archive=arquivo.pt   just one
#   sh get.sh --concurrency=6

set -e

# 0. Fetch each archive's capture index.
node src/000_fetchIndex.js "$@"

# 1. Find when the site went offline. One GLOBAL cutoff for every archive:
#    the site died once, and archives that never captured a placeholder page
#    would otherwise keep post-mortem junk.
node src/001_cutoffDate.js

# 2. Keep the newest good capture of every URL, per archive.
node src/002_latestVersions.js "$@"

# 3. Turn those into download jobs with local target paths.
node src/003_downloadList.js "$@"

# 4. Download whatever is missing or outdated, verifying every file.
node src/004_download.js "$@"
