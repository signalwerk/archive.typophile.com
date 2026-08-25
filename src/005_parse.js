import fs from "fs";
import cheerio from "cheerio";

export function load(filename) {
  const htmlString = fs.readFileSync(filename, "utf8");
  return cheerio.load(htmlString);
}

function parseDate(str) {
  //   console.log("--- parse", str);
  const dateString = str.trim();

  // Parse the date parts
  const parts = dateString.split(/[\s-—:]+/);
  const day = parts[0];
  const month = getMonthNumber(parts[1]);
  const year = parts[2];

  // Parse the time parts
  const hours = parseInt(parts[3]);
  const minutes = parseInt(parts[4]);
  const meridian = parts[5];

  // Convert hours to 24h time if necessary
  if (meridian === "pm" && hours !== 12) {
    hours += 12;
  }

  //   console.log({ year, month, day, hours, minutes });

  // Create a new Date object using the parsed parts
  const date = new Date(year, month, day, hours, minutes);
  const timestamp = date.getTime();
  return timestamp;

  // Function to get the month number from the month name
  function getMonthNumber(monthName) {
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const normalizedMonthName = monthName.trim().toLowerCase().slice(0, 3);
    return months.indexOf(normalizedMonthName);
  }
}

function empty() {
  const result = {
    id: null,
    title: null,
    forum: {
      id: null,
      title: null,
    },
    taxonomy: [],
    node: {
      timestamp: null,
      user: {
        id: null,
        name: null,
        image: null,
      },
      content: {
        html: null,
      },
    },
    comments: [],
  };

  return result;
}

function parseNode($) {
  const result = empty();

  const breadcrumb = $(".breadcrumb");
  const node = $(".node");
  const comments = $("#comments");

  // parse node
  result.id = parseInt(node.get(0).attribs.id.split("-")[1]);
  result.title = $(".breadcrumb + h2").text();
  result.node.timestamp = parseDate(
    node.find(".submitted").find("br").get(0).nextSibling.nodeValue
  );
  const forum = breadcrumb.find("a").last();
  result.forum.id = parseInt(forum.first().attr("href").split("/").at(-1));
  result.forum.title = forum.text();
  const userinfo = node.find(".userinfo");
  const header = node.find(".content-head");
  result.node.user.id = parseInt(
    userinfo.find(".picture a").first().attr("href").split("/").at(-1),
    10
  );
  result.node.user.name = header.find(".submitted > a").text();
  result.node.user.image = userinfo.find(".picture a img").first().attr("src");

  result.taxonomy = header
    .find("li")
    .map((i, el) => {
      return {
        id: parseInt(
          $(el).find("a").first().attr("href").split("/").at(-1),
          10
        ),
        title: $(el).text(),
      };
    })
    .get();

  result.node.content.html = node.find(".content").html();

  // parse comments
  result.comments = comments
    .find(".comment")
    .map((i, el) => {
      const result = {
        id: null,
        timestamp: null,
        user: {
          id: null,
          name: null,
          image: null,
        },
        content: {
          html: null,
        },
      };

      const comment = $(el);

      result.user.id = parseInt(
        comment.find(".info a").first().attr("href").split("/").at(-1),
        10
      );
      result.user.name = comment.find(".info a").first().text();
      result.user.image = comment
        .find(".infopic .picture a img")
        .first()
        .attr("src");
      result.content.html = comment.find(".content").html();

      return result;
    })
    .get();

  return result;
}

function parseOldNode($, download) {
  const result = empty();

  const node = $(".node");
  const comments = $("#comment + form");

  // parse node
  result.id = download.$process.nodeId;
  result.title = $("title")
    .text()
    .replace(/ \| Typophile$/, "");
  result.node.timestamp = parseDate(
    node.find("> .info").find("br").get(0).nextSibling.nodeValue
  );

  // const userinfo = node.find(".userinfo");
  // const header = node.find(".content-head");
  result.node.user.id = parseInt(
    node.find("> .picture a").first().attr("href").split("/").at(-1),
    10
  );
  result.node.user.name = node
    .find("> .info")
    .find("br")
    .get(0).previousSibling.nodeValue;

  result.node.user.image = node.find("> .picture a img").first().attr("src");

  // result.taxonomy = header
  //   .find("li")
  //   .map((i, el) => {
  //     return {
  //       id: parseInt(
  //         $(el).find("a").first().attr("href").split("/").at(-1),
  //         10
  //       ),
  //       title: $(el).text(),
  //     };
  //   })
  //   .get();

  result.node.content.html = node.find(".content").html();

  // parse comments
  result.comments = comments
    .find("a")
    .map((i, el) => {
      const result = {
        id: null,
        timestamp: null,
        user: {
          id: null,
          name: null,
          image: null,
        },
        content: {
          html: null,
        },
      };

      const comment = $(el).next("div.comment");

    //   const author = comment.find(".author a");
    //   result.user.name = author.text();

    //   result.user.id = parseInt(
    //     author.first().attribs.id.split("/").at(-1),
    //     10
    //   );


      //   console.log(comment.find(".author a"));

      //   result.user.name = comment
      //   .find("> .author")
      //   .find("br")
      //   .get(0).nextSibling.nodeValue;
      // result.user.image = comment
      //   .find(".infopic .picture a img")
      //   .first()
      //   .attr("src");
      // result.content.html = comment.find(".content").html();

      return result;
    })
    .get();

  return result;
}

const downloads = JSON.parse(
  fs.readFileSync("data/web.archive/004_typophile.com.download.json", "utf8")
);

downloads.slice(0, 1).forEach((download) => {
  const $ = load(
    `data/web.archive/typophile.com/${download.$process.path}.html`
  );
  //   const $ = load(`data/web.archive/typophile.com/node/100223.html`);
  let result = null;

  const bodyCLS = $("body").attr("class");
  if (bodyCLS === "sidebars") {
    console.log(`process file [style modern]: ${download.$process.path}`);
    result = parseNode($);
  } else if ($("#content-frame").length) {
    console.log(`process file [style old] !!!!!: ${download.$process.path}`);
    result = parseOldNode($, download);
  } else {
    console.log(`NOT process file: ${download.$process.path}`);
  }

  if (result) {
    fs.writeFileSync(
      `data/process/${download.$process.path}.json`,
      JSON.stringify(result, null, 2)
    );
  }
});
