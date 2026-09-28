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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (typeof window !== 'undefined' && (!window.navigator.clipboard || !window.navigator.clipboard.writeText)) {
                  var shimClipboard = {
                    writeText: function(text) {
                      return new Promise(function(resolve, reject) {
                        try {
                          var el = document.createElement('textarea');
                          el.value = text;
                          el.setAttribute('readonly', '');
                          el.style.position = 'fixed';
                          el.style.top = '0';
                          el.style.left = '0';
                          el.style.opacity = '0';
                          (document.body || document.documentElement).appendChild(el);
                          el.focus();
                          el.select();
                          if (el.setSelectionRange) el.setSelectionRange(0, el.value.length);
                          var ok = document.execCommand('copy');
                          (document.body || document.documentElement).removeChild(el);
                          if (ok) resolve(); else reject(new Error('execCommand copy failed'));
                        } catch (err) {
                          reject(err);
                        }
                      });
                    },
                    readText: function() {
                      return Promise.resolve('');
                    }
                  };
                  try {
                    Object.defineProperty(window.navigator, 'clipboard', {
                      value: shimClipboard,
                      writable: true,
                      configurable: true
                    });
                  } catch (_) {
                    try {
                      Object.defineProperty(window.Navigator.prototype, 'clipboard', {
                        get: function() { return shimClipboard; },
                        configurable: true
                      });
                    } catch (__) {}
                  }
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
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
