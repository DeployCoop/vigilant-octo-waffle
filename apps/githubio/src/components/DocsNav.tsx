'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const DOCS_NAV = [
  {
    group: 'Start here',
    items: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/docs/configuration', label: 'Configuration' },
    ],
  },
  {
    group: 'Guides',
    items: [
      { href: '/docs/gitops', label: 'GitOps: ArgoCD & FluxCD' },
      { href: '/docs/web-control-plane', label: 'Web control plane' },
      { href: '/docs/cli', label: 'CLI & the vow TUI' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { href: '/docs/authorization', label: 'Authorization' },
      { href: '/docs/architecture', label: 'Architecture' },
    ],
  },
] as const;

export function DocsNav() {
  const pathname = usePathname();
  return (
    <>
      {DOCS_NAV.map((section) => (
        <div key={section.group}>
          <div className="group">{section.group}</div>
          <nav>
            {section.items.map((item) => {
              const active =
                pathname === item.href || pathname === `${item.href}/`;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? 'active' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </>
  );
}

/** Prev/next footer for a docs page, driven by the nav order. */
export function DocPager({ current }: { current: string }) {
  const flat = DOCS_NAV.flatMap((s) => [...s.items]);
  const idx = flat.findIndex((i) => i.href === current);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  return (
    <div className="next">
      <span>{prev && <Link href={prev.href}>← {prev.label}</Link>}</span>
      <span>{next && <Link href={next.href}>{next.label} →</Link>}</span>
    </div>
  );
}
