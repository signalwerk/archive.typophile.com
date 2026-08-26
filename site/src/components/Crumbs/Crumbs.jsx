import { Fragment } from "react";

// The trail above a page title. Each step is { label, href }; a step without an
// href is where you are, so it is not a link.
export function Crumbs({ trail }) {
  const steps = (trail ?? []).filter(Boolean);
  if (steps.length === 0) return null;

  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {steps.map((step, i) => (
        <Fragment key={`${step.label}-${i}`}>
          {i > 0 ? <span className="crumbs__separator">&rsaquo;</span> : null}
          {step.href ? <a href={step.href}>{step.label}</a> : <span>{step.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
