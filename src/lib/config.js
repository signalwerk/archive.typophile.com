// Central configuration for the typophile.com archive pipeline.

export const DOMAIN = "typophile.com";

export const DIRS = {
  data: "data",
  cdx: "data/cdx",
  cdxPages: "data/cdx/pages",
  index: "data/index",
  files: "data/files",
  state: "data/state",
};

export const FILES = {
  cdxMeta: "data/cdx/meta.json",
  cdx: `data/cdx/${DOMAIN}.cdx`,
  cutoff: "data/index/001_cutoff.json",
  latest: "data/index/002_latest.jsonl",
  latestMeta: "data/index/002_latest.meta.json",
  downloads: "data/index/003_downloads.jsonl",
  downloadsMeta: "data/index/003_downloads.meta.json",
  downloadState: "data/state/downloads.jsonl",
  failures: "data/state/failures.jsonl",
};

// Checksums of captures that show an "offline" placeholder instead of real
// content. The earliest capture carrying one of these marks the moment the
// site went down -- everything from then on is worthless, so we only keep
// captures strictly older than that cutoff.
export const OFFLINE_HASHES = {
  LAQLAMRVDS5VQFZECJLHS3S7MOTE3HBU: "Typophile turned 15 years old this month. Time for a reboot.",
  "3COOZZTE4S6HH7QGZF7AHHQ5ETTXVPA3": "Typophile turned 15 years old this month. Time for a reboot.",
  FOTMZZTR5CDCUTIR6IINFKBBM3KY7PDJ: "Site off-line",
  "6FSTKSIHOGPKWOUZ72R7WHAU4YTIGVKV": "Site off-line",
  JK6WPGOR6SZJFUVHUYQXIAEKJ4U7TKDJ: "Typophile is temporarily down for maintenance.",
};

// Set to a 14-digit timestamp to override the detected cutoff entirely.
export const CUTOFF_OVERRIDE = null;

export const HTTP = {
  userAgent:
    "archive.typophile.com/1.0 (personal archival project; +https://github.com/signalwerk/archive.typophile.com)",
  concurrency: 4,
  timeoutMs: 90_000,
  retries: 5,
  backoffBaseMs: 2_000,
  maxBackoffMs: 120_000,
  // Minimum spacing between request starts, across all workers.
  minRequestIntervalMs: 100,
};
