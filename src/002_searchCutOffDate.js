import fs from "fs";

const data = JSON.parse(
  fs.readFileSync("data/web.archive/002_typophile.com.groupByURI.json", "utf8")
);

const offlineHashes = [
  "LAQLAMRVDS5VQFZECJLHS3S7MOTE3HBU", // Typophile turned 15 years old this month. Time for a reboot.
  "3COOZZTE4S6HH7QGZF7AHHQ5ETTXVPA3", // Typophile turned 15 years old this month. Time for a reboot.
  "FOTMZZTR5CDCUTIR6IINFKBBM3KY7PDJ", // Site off-line
  "6FSTKSIHOGPKWOUZ72R7WHAU4YTIGVKV", // Site off-line
  "JK6WPGOR6SZJFUVHUYQXIAEKJ4U7TKDJ", // Typophile is temporarily down for maintenance. (probably newer version)
];

const result = {
  cutoff: Infinity,
};

// find the first entry that is offline
// offlineHashes holds the checksums of some offline entries
// find biggest smallest that is offline
for (const [key, arr] of Object.entries(data.urls)) {
  const offlinePages = arr.filter((obj) => {
    return offlineHashes.includes(obj.checksum);
  });

  // get the first offline page (smallest timestamp)
  const firstOffline = offlinePages.sort((a, b) => {
    return b.timestamp - a.timestamp;
  })[0];

  if (firstOffline) {
    result.cutoff = Math.min(result.cutoff, firstOffline.timestamp);
  }
}

fs.writeFileSync(
  "data/web.archive/003_cutoff_date.json",
  JSON.stringify(result, null, 2)
);
