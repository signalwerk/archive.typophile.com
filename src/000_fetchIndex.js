// Step 0 -- fetch the capture index from each archive.
//
// Each archive publishes its index differently (the Wayback Machine pages a
// text CDX, arquivo.pt answers in one JSON request, Common Crawl has a
// separate index per monthly crawl), so the details live in the adapters
// under src/lib/archives/. All of them are resumable: whatever is already on
// disk is not fetched again.
//
//   node src/000_fetchIndex.js                       all archives
//   node src/000_fetchIndex.js --archive=arquivo.pt
//   node src/000_fetchIndex.js --archive=commoncrawl.org --crawls=2013,2014,2015
//   node src/000_fetchIndex.js --refresh             re-check for new captures
//   node src/000_fetchIndex.js --force               refetch everything

import { archiveDirs } from "./lib/config.js";
import { selectArchives } from "./lib/archives/index.js";
import { ensureDir, parseArgs, acquireLock } from "./lib/util.js";

const args = parseArgs();

async function main() {
  const archives = selectArchives(args.archive);

  for (const archive of archives) {
    const dirs = archiveDirs(archive.id);
    ensureDir(dirs.raw);
    console.log(`\n=== ${archive.label} (${archive.id}) ===`);
    const log = (msg) => console.log(msg);
    let release;
    try {
      // Two index fetches for one archive would fight over the same files.
      release = acquireLock(`${dirs.raw}/fetch.lock`, `index fetch of ${archive.id}`);
      await archive.fetchIndex({ dirs, args, log });
    } catch (err) {
      console.error(err.code === "ELOCKED" ? `   skipped: ${err.message}` : `   failed: ${err.message}`);
      if (archives.length === 1 && err.code !== "ELOCKED") process.exitCode = 1;
    } finally {
      release?.();
    }
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
