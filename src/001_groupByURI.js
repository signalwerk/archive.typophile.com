import fs from "fs";
import readline from "readline";

const line_counter = (
  (i = 0) =>
  () =>
    ++i
)();

const lineReader = readline.createInterface({
  input: fs.createReadStream("data/web.archive/001_typophile.com.cdx"),
});

const result = {
  urls: {},
};

lineReader.on("line", (line, index = line_counter()) => {
  //   console.log("Line from file:", line);

  const fields = line.split(" ");
  const url = fields[0];
  const timestamp = fields[1];
  const originalUrl = fields[2];
  const mimeType = fields[3];
  const responseCode = fields[4];
  const checksum = fields[5];
  const redirectUrl = fields[6];

  const obj = {
    url,
    timestamp,
    originalUrl,
    mimeType,
    responseCode,
    checksum,
    redirectUrl,
  };

  if (result.urls[url] === undefined) {
    result.urls[url] = [];
  }

  result.urls[url].push(obj);

  if (index % 50_000 === 0) {
    console.log(`   lines processed: ${index} `);
  }
});

lineReader.on("close", () => {
  
  // remove duplicate entries from the array if the checksum is the same
  Object.keys(result.urls).forEach((url) => {
    const arr = result.urls[url];
    const unique = arr.filter(
      (v, i, a) => a.findIndex((t) => t.checksum === v.checksum) === i
    );
    result.urls[url] = unique;
  });

  fs.writeFileSync(
    "data/web.archive/002_typophile.com.groupByURI.json",
    JSON.stringify(result, null, 2)
  );
});
