import type { Metadata } from 'next';
import './globals.css';
import { Sidebar, Header } from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'Vigilant Octo Waffle | Local DevOps Control Plane',
  description: 'Local Kubernetes cluster & GitOps management application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen flex bg-slate-950 text-slate-100 antialiased selection:bg-sky-500 selection:text-white" suppressHydrationWarning>
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 p-6 md:p-8 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
