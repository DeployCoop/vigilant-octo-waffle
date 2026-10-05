import type { ReactNode } from 'react';
import { DocsNav } from '../../components/DocsNav';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wrap">
      <div className="docs-shell">
        <aside className="docs-side">
          <DocsNav />
        </aside>
        <article className="doc">{children}</article>
      </div>
    </div>
  );
}
