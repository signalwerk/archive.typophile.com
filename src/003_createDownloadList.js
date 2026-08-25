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
for (const [key, item] of Object.entries(result.urls)) {
  if (
    item.mimeType === "text/html" &&
    key.match(/com\,typophile\)\/node\/[0-9]+$/)
  ) {

    const { host, path } = key2url(item.url);
   const nodeId = parseInt(path.split("/").at(-1), 10)
    const url = `http://${host}${path}`;

    downloads.push({ ...item, 
      
      $process: { 
        
        
        url, path, host, nodeId } });
  }
}

fs.writeFileSync(
  "data/web.archive/004_typophile.com.download.json",
  JSON.stringify(downloads, null, 2)
);

const prefix = `download_file() {
  url=$1
  filepath=$2

  if [ ! -f "$filepath" ]; then
    echo "Downloading file from $url"
    curl -o "$filepath" "$url"
  else
    echo "File already exists at $filepath"
  fi
}

`


fs.writeFileSync(
  "data/web.archive/004_typophile.com.download.sh",
  `${prefix}${downloads
    .map((item) => {
      return `download_file http://web.archive.org/web/${item.timestamp}${
        loadOriginal ? "id_" : ""
      }/${encodeURI(item.$process.url)} data/web.archive/typophile.com${
        item.$process.path
      }.html`;
    })
    .join("\n")}`
);
