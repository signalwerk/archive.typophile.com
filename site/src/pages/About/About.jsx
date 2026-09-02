import { Layout } from "../../components/Layout/Layout.jsx";

const REPO = "https://github.com/signalwerk/archive.typophile.com";

export function AboutPage({ totals, forums, archives }) {
  return (
    <Layout>
      <h1 className="h1">About this archive</h1>

      <p>
        Typophile was a discussion board about typography and type design. It
        went offline in 2015, returned in late 2016, and went offline for the
        final time in 2019. What you are reading here was rebuilt from copies
        that web archives happened to keep.
      </p>

      <h2 className="section-title">Where it comes from</h2>
      <p>
        Nothing here was scraped from the live site — there is no live site.
        Every page was recovered from one of three independent web archives:
      </p>
      <ul className="plain">
        <li>
          <a href="https://web.archive.org/" rel="noreferrer">
            Internet Archive Wayback Machine
          </a>
        </li>
        <li>
          <a href="https://arquivo.pt/" rel="noreferrer">
            Arquivo.pt
          </a>
          , the Portuguese Web Archive
        </li>
        <li>
          <a href="https://commoncrawl.org/" rel="noreferrer">
            Common Crawl
          </a>
        </li>
      </ul>
      <p>
        For each address, the newest valid capture before the final outage is
        used. Known maintenance, offline and server-error pages are skipped,
        and every file is checked against the checksum its archive recorded, so
        what you see is the bytes that were captured rather than a
        reconstruction. Each thread names the archive and the exact moment its
        copy was made.
      </p>

      <h2 className="section-title">It is incomplete</h2>
      <p>
        The archives did not capture everything, and some of what they captured
        is partial. Long discussions ran across several pages and not all of
        them survived; where that happens the thread says so rather than quietly
        showing a fraction. Images and files mostly point at addresses that no
        longer answer.
      </p>
      {totals ? (
        <p className="lede">
          {totals.threads.toLocaleString("en-US")} threads and{" "}
          {totals.comments.toLocaleString("en-US")} replies recovered so far,
          across {forums} forums.
        </p>
      ) : null}

      <h2 className="section-title">Changes to the original content</h2>
      <p>
        Posts are shown as they were captured. Where that is not true, it is
        listed here. This list will grow as more is done to the material.
      </p>
      <ul className="changes">
        <li>
          <strong>Links point here where they can.</strong> A link inside a post
          that pointed at a thread or a member we recovered is repointed at our
          copy of it. Only the address changes — the wording of the link and
          everything around it are untouched. A link to something we do not have
          keeps its original address and stays dead, rather than pretending to
          lead somewhere.
        </li>
        <li>
          <strong>Every link says where it leads.</strong> An arrow marks one
          that leaves this site, a green dot one whose page or file we hold, a
          red dot one that is gone.
        </li>
        <li>
          <strong>Mangled addresses are mended.</strong> The old site turned a
          few hundred pasted links into broken wiki addresses. Those are put
          back the way they were written.
        </li>
        <li>
          <strong>Anything that runs is removed.</strong> Scripts, styles,
          embedded frames and objects, forms, inline event handlers and{" "}
          <code>javascript:</code> addresses are stripped before a page is
          rendered. The words and the structure of a post are left alone.
        </li>
        <li>
          <strong>
            Embedded images and attachments point here where we have them.
          </strong>{" "}
          A picture in a post, or a file somebody attached, is copied out of the
          archive and the post is pointed at our copy. Where the archives never
          captured the file, the tag is left as it was and the image stays
          broken rather than pointing somewhere that looks right and is not.
        </li>
        <li>
          <strong>Member pages show less than the profiles did.</strong> Where
          somebody lived, when they joined, and details they filled in about
          themselves — gender, social accounts, occupation, education — are not
          shown. Only a name and a home page remain.
        </li>
      </ul>
      <p>
        The originals are not ours to alter: every thread names the archive its
        copy came from and the moment it was taken, and links to that capture.
      </p>

      <h2 className="section-title">Who made it</h2>
      <p>
        Put together by{" "}
        <a href="https://signalwerk.ch/" rel="noreferrer">
          Stefan Huber
        </a>
        . The code that fetches, verifies, parses and renders all of this is on{" "}
        <a href={REPO} rel="noreferrer">
          GitHub
        </a>{" "}
        — including the parts that record what is missing.
      </p>
    </Layout>
  );
}
