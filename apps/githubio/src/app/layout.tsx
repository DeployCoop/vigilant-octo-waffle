import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { asset } from '../lib/base-path';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Vigilant Octo Waffle — local Kubernetes, minus the localhost lies',
    template: '%s · Vigilant Octo Waffle',
  },
  description:
    'Vigilant Octo Waffle spins up real local Kubernetes clusters (KinD or K3s) with trusted TLS, ArgoCD or FluxCD GitOps, and a 45+ app catalog — driven from a web control plane, a terminal UI, or bash.',
};

const REPO = 'https://github.com/DeployCoop/vigilant-octo-waffle';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link className="brand" href="/">
              <Image src={asset('/logo.png')} alt="" width={30} height={30} />
              Vigilant Octo Waffle
            </Link>
            <nav className="site-nav">
              <Link href="/">Showcase</Link>
              <Link href="/docs">Documentation</Link>
              <a href={REPO}>GitHub</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="inner">
            <span>
              🧇 Vigilant Octo Waffle — a DeployCoop project. Local testing
              and development; not a production platform.
            </span>
            <span>
              <a href={REPO}>Repository</a> ·{' '}
              <a href={`${REPO}/blob/main/ARCHITECTURE.md`}>Architecture</a> ·{' '}
              <a href={`${REPO}/blob/main/ROADMAP.md`}>Roadmap</a> ·{' '}
              <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
