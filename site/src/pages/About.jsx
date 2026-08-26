import { Layout } from "../components/Layout.jsx";

const REPO = "https://github.com/signalwerk/archive.typophile.com";

export function AboutPage({ totals, forums, archives }) {
  return (
    <Layout>
      <h1 className="page-title">About this archive</h1>

      <p>
        Typophile was a discussion board about typography and type design. It
        went offline in 2015 and its pages have not been served since. What you
        are reading here was rebuilt from copies that web archives happened to
        keep.
      </p>

      <h2 className="section-title">Where it comes from</h2>
      <p>
        Nothing here was scraped from the live site — there is no live site.
        Every page was recovered from one of three independent web archives:
      </p>
      <ul className="plain">
        <li>
          <a href="https://web.archive.org/" rel="noreferrer">Internet Archive Wayback Machine</a>
        </li>
        <li>
          <a href="https://arquivo.pt/" rel="noreferrer">Arquivo.pt</a>, the Portuguese Web Archive
        </li>
        <li>
          <a href="https://commoncrawl.org/" rel="noreferrer">Common Crawl</a>
        </li>
      </ul>
      <p>
        For each address, the newest capture taken before the site went dark is
        used, and every file is checked against the checksum its archive
        recorded, so what you see is the bytes that were captured rather than a
        reconstruction. Each thread names the archive and the exact moment its
        copy was made.
      </p>

      <h2 className="section-title">It is incomplete</h2>
      <p>
        The archives did not capture everything, and some of what they captured
        is partial. Long discussions ran across several pages and not all of
        them survived; where that happens the thread says so rather than
        quietly showing a fraction. Images and files mostly point at addresses
        that no longer answer.
      </p>
      {totals ? (
        <p className="lede">
          {totals.threads.toLocaleString("en-US")} threads and{" "}
          {totals.comments.toLocaleString("en-US")} replies recovered so far,
          across {forums} forums.
        </p>
      ) : null}

      <h2 className="section-title">Who made it</h2>
      <p>
        Put together by <a href="https://signalwerk.ch/" rel="noreferrer">Stefan Huber</a>.
        The code that fetches, verifies, parses and renders all of this is on{" "}
        <a href={REPO} rel="noreferrer">GitHub</a> — including the parts that
        record what is missing.
      </p>
    </Layout>
  );
}
