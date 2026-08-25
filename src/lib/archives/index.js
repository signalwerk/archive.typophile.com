import webarchive from "./webarchive.js";
import arquivo from "./arquivo.js";
import commoncrawl from "./commoncrawl.js";

export const ARCHIVES = [webarchive, arquivo, commoncrawl];

export const ARCHIVE_IDS = ARCHIVES.map((a) => a.id);

export function getArchive(id) {
  const found = ARCHIVES.find((a) => a.id === id || a.id.split(".")[0] === id);
  if (!found) {
    throw new Error(`unknown archive "${id}" -- known: ${ARCHIVE_IDS.join(", ")}`);
  }
  return found;
}

// `--archive=all` (or nothing) means every archive.
export function selectArchives(arg) {
  if (!arg || arg === "all" || arg === true) return ARCHIVES;
  return String(arg).split(",").map((s) => getArchive(s.trim()));
}
