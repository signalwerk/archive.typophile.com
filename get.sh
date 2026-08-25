#!/bin/sh
# Fetch the last living version of typophile.com from the Wayback Machine.
#
# Every step is resumable and safe to re-run: nothing already correct on disk
# is fetched twice. Interrupt with Ctrl-C whenever you like and start again.
#
#   sh get.sh
#
# Pass extra flags to the downloader through, e.g.:
#   sh get.sh --concurrency=6

set -e

# 0. Fetch the CDX index (paged; skips pages already on disk).
node src/000_fetchCDX.js

# 1. Find when the site went offline -- later captures are placeholders.
node src/001_cutoffDate.js

# 2. Keep the newest good capture of every URL.
node src/002_latestVersions.js

# 3. Turn those into download jobs with local target paths.
node src/003_downloadList.js

# 4. Download whatever is missing or outdated, verifying every file.
node src/004_download.js "$@"
