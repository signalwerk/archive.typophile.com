import { Layout, formatDate } from "../components/Layout.jsx";
import { Avatar } from "../components/Avatar.jsx";

function Activity({ title, items, empty }) {
  if (!items.length) return null;
  return (
    <section className="activity">
      <h2 className="section-title">
        {title} <span className="count">{items.length}</span>
      </h2>
      <ul className="threads">
        {items.map((it, i) => (
          <li key={`${it.node}-${it.comment ?? i}`}>
            <a className="thread__title" href={`/node/${it.node}/${it.comment ? `#comment-${it.comment}` : ""}`}>
              {it.title || `node ${it.node}`}
            </a>
            <div className="thread__meta">{it.date ? <span>{formatDate(it.date)}</span> : null}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Profile({ profile }) {
  if (!profile) return null;
  const place = [profile.city, profile.state, profile.country].filter(Boolean).join(", ");
  const rows = [
    ["Full name", profile.name],
    ["Location", place || null],
    ["Occupation", profile.occupation],
    ["Member since", profile.member_since ? `${profile.member_since} (${profile.member_for})` : null],
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
  return (
    <Layout wide>
      <div className="crumbs">
        <a href="/">Typophile</a> &rsaquo; <a href="/users/">members</a>
      </div>

      <header className="profile">
        <Avatar user={doc} size={72} />
        <div>
          <h1>{doc.name || `user ${doc.user}`}</h1>
          <p className="profile__meta">
            user {doc.user}
            {doc.first_seen ? <> · active {formatDate(doc.first_seen)} – {formatDate(doc.last_seen)}</> : null}
            <> · {doc.counts.posts} threads · {doc.counts.comments} replies</>
          </p>
          {doc.profile?.city || doc.profile?.country ? (
            <p className="profile__meta">
              {[doc.profile.city, doc.profile.state, doc.profile.country].filter(Boolean).join(", ")}
              {doc.profile.member_since ? <> · member since {doc.profile.member_since}</> : null}
            </p>
          ) : null}
          {doc.also_known_as?.length ? (
            <p className="profile__meta">also posted as {doc.also_known_as.join(", ")}</p>
          ) : null}
        </div>
      </header>

      <Profile profile={doc.profile} />

      <Activity title="Threads started" items={doc.posts ?? []} />
      <Activity title="Replies" items={doc.comments ?? []} />
    </Layout>
  );
}
