import fs from "fs";

const loadOriginal = false;

const data = JSON.parse(
  fs.readFileSync("data/web.archive/002_typophile.com.groupByURI.json", "utf8")
);

const cutoff = JSON.parse(
  fs.readFileSync("data/web.archive/003_cutoff_date.json", "utf8")
).cutoff;

const result = {
  urls: {},
};

for (const [key, arr] of Object.entries(data.urls)) {
  const onlinePages = arr
    .filter((obj) => {
      return obj.responseCode < 400;
    })
    .filter((obj) => {
      return obj.timestamp < cutoff;
    });

  // get the newest file that is not offline (biggest timestamp)
  const lastOnline = onlinePages.sort((a, b) => {
    return b.timestamp - a.timestamp;
  })[0];

  if (lastOnline) {
    result.urls[lastOnline.url] = lastOnline;
  }
}
fs.writeFileSync(
  "data/web.archive/004_typophile.com.lastOnline.json",
  JSON.stringify(result, null, 2)
);

function key2url(key) {
  let [rawhost, path] = key.split(")");

  return {
    host: rawhost.split(",").reverse().join("."),
    path,
  };
}

const downloads = [];
for (const [key, value] of Object.entries(result.urls)) {
  if (
    value.mimeType === "text/html" &&
    key.match(/com\,typophile\)\/node\/[0-9]+$/)
  ) {
    // downloads.push(`wget -r -np -nH -k -L -p -P data/web.archive/typophile.com ${key}`);

    downloads.push(value);
  }
}
fs.writeFileSync(
  "data/web.archive/004_typophile.com.lastOnline.sh",
  downloads
    .map((item) => {
      const { host, path } = key2url(item.url);
      const url = `http://${host}${path}`;

      return `curl http://web.archive.org/web/${item.timestamp}${
        loadOriginal ? "id_" : ""
      }/${encodeURI(url)} > data/web.archive/typophile.com${path}.html`;
    })
    .join("\n")
);
