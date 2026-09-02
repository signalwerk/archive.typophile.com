#!/bin/sh
# Recover typophile.com from every archive we can reach, then parse it.
#
# Archives covered:
#   web.archive.org   Internet Archive Wayback Machine
#   arquivo.pt        Arquivo.pt (Portuguese Web Archive)
#   commoncrawl.org   Common Crawl
#
# Every step is resumable and safe to re-run: nothing already correct on disk
# is fetched or re-parsed twice. Interrupt with Ctrl-C whenever you like and
# start again.
#
#   sh get.sh                        all archives
#   sh get.sh --archive=arquivo.pt   just one
#   sh get.sh --concurrency=6

set -e

# --- collect -----------------------------------------------------------------

# 0. Fetch each archive's capture index.
node src/000_fetchIndex.js "$@"

# 1. Find the beginning of the final outage. Earlier placeholder periods are
#    rejected by digest because the real site later returned. The final cutoff
#    is global so archives that missed it do not keep post-mortem junk.
node src/001_cutoffDate.js

# 2. Keep the newest good capture of every URL, per archive.
node src/002_latestVersions.js "$@"

# 3. Turn those into download jobs with local target paths.
node src/003_downloadList.js "$@"

# 4. Download whatever is missing or outdated, verifying every file.
node src/004_download.js "$@"

# --- parse -------------------------------------------------------------------

# 5. Across all three archives, pick which copy of each /node/ page to parse.
node src/005_selectNodes.js

# 6. Parse those into one YAML per node. Warnings/errors go to
#    data/parsed/parse.log.
node src/006_parseNodes.js

# 7. Build one file per member from the bylines step 6 recorded, and copy
#    their avatars out of the archives into the parsed data.
node src/007_users.js

# 8. Clean up the stored HTML: mend addresses the old site mangled, repoint
#    links at the copies we hold, and mark every link with where it leads.
node src/008_cleanHtml.js

# 9. Summarise every thread into one line, so listing pages never open all
#    62,000 files. Keyed on the capture each thread came from, so step 8
#    rewriting the files costs this nothing.
node src/009_threadIndex.js

# 10. Match the old /forums/messages/<forum>/<thread>.html discussions to the
#     Drupal nodes they became, store that address, and log recovered old
#     discussions with no captured node counterpart.
node src/010_oldUrls.js

# 11. Parse recovered old discussions that have no captured Drupal node into a
#     separate node-shaped corpus, keyed by old forum id and message id.
node src/011_oldMessages.js

# 12. Copy the old site's interface files that parsed post content does not
#     otherwise pull into the published data set.
node src/012_specialFiles.js
