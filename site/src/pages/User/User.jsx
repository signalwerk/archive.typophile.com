import { Layout } from "../../components/Layout/Layout.jsx";
import { Fragment } from "react";
import { DateTime } from "../../components/DateTime/DateTime.jsx";
import { Avatar } from "../../components/Avatar/Avatar.jsx";
import { NodePreview } from "../../components/NodePreview/NodePreview.jsx";

// `threadContext` adds the forum and the thread's reply count. A member's own
// replies do not carry it: the count would be the whole thread's, not theirs,
// which reads as if they had written all of them.
function Activity({ title, items, threadContext = false }) {
  if (!items.length) return null;
  return (
    <section className="activity">
      <h2 className="section-title">
        {title} <span className="count">{items.length}</span>
      </h2>
      <ul className="threads">
        {items.map((it, i) => (
          <NodePreview
            key={`${it.node}-${it.comment ?? i}`}
            id={it.node}
            title={it.title}
            href={`/node/${it.node}/${it.comment ? `#comment-${it.comment}` : ""}`}
            date={it.date}
            comments={threadContext ? it.comments : undefined}
            forum={threadContext ? it.forum : undefined}
            forumTitle={threadContext ? it.forumTitle : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

function Profile({ profile }) {
  if (!profile) return null;
  // Location and the join date are already in the header, above this list.
  const rows = [
    ["Full name", profile.name],
    ["Occupation", profile.occupation],
    ["Home page", profile.home_page],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return (
    <section className="activity">
      <h2 className="section-title">Profile</h2>
      <dl className="profile-fields">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {/^https?:\/\//.test(String(value))
                ? <a href={value} rel="nofollow noreferrer">{value}</a>
                : value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function UserPage({ doc }) {
  // Built as a list so a missing piece cannot leave a stray separator behind.
  const facts = [];
  if (doc.first_seen) {
    facts.push(
      <>
        active <DateTime value={doc.first_seen} dateOnly /> –{" "}
        <DateTime value={doc.last_seen} dateOnly />
      </>
    );
  }
  facts.push(<>{doc.counts.posts} {doc.counts.posts === 1 ? "thread" : "threads"}</>);
  facts.push(<>{doc.counts.comments} {doc.counts.comments === 1 ? "reply" : "replies"}</>);

  return (
    <Layout wide>
      <div className="crumbs">
        <a href="/">Typophile</a> &rsaquo; member
      </div>

      <header className="profile">
        <Avatar user={doc} size={72} />
        <div>
          <h1>{doc.name || `user ${doc.user}`}</h1>
          <p className="profile__meta">
            {facts.map((fact, i) => (
              <Fragment key={i}>
                {i > 0 ? " · " : null}
                {fact}
              </Fragment>
            ))}
          </p>
          {doc.also_known_as?.length ? (
            <p className="profile__meta">also posted as {doc.also_known_as.join(", ")}</p>
          ) : null}
        </div>
      </header>

      <Profile profile={doc.profile} />

      <Activity title="Threads started" items={doc.posts ?? []} threadContext />
      <Activity title="Replies" items={doc.comments ?? []} />
    </Layout>
  );
}
