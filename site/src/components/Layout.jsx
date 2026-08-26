
export function Layout({ children, wide = false }) {
  return (
    <div className={wide ? "page" : "page page--reading"}>
      <header className="masthead">
        <h1 className="masthead__title">
          <a href="/">Typophile</a>
        </h1>
        <nav className="masthead__nav">
          <a href="/about/">about</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
