import type { Metadata } from 'next';
import './globals.css';
import { Sidebar, Header } from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'Vigilant Octo Waffle | Local DevOps Control Plane',
  description: 'Local Kubernetes cluster & GitOps management application',
  other: {
    'darkreader-lock': 'true',
    'color-scheme': 'dark',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="darkreader-lock" content="true" />
        <meta name="color-scheme" content="dark" />
        <meta name="darkreader" content="NO-DARK-READER" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Prevent browser extensions like Dark Reader from mutating DOM before hydration
                if (typeof window !== 'undefined') {
                  var cleanDarkReaderAttrs = function(node) {
                    if (node && node.nodeType === 1) {
                      if (node.hasAttribute('data-darkreader-inline-stroke')) node.removeAttribute('data-darkreader-inline-stroke');
                      if (node.hasAttribute('data-darkreader-inline-fill')) node.removeAttribute('data-darkreader-inline-fill');
                      if (node.hasAttribute('data-darkreader-proxy-injected')) node.removeAttribute('data-darkreader-proxy-injected');
                      if (node.style && node.style.getPropertyValue('--darkreader-inline-stroke')) {
                        node.style.removeProperty('--darkreader-inline-stroke');
                      }
                      if (node.style && node.style.getPropertyValue('--darkreader-inline-fill')) {
                        node.style.removeProperty('--darkreader-inline-fill');
                      }
                    }
                  };

                  // Initial scrub
                  if (document.documentElement) {
                    cleanDarkReaderAttrs(document.documentElement);
                  }

                  if (window.MutationObserver) {
                    var drObserver = new MutationObserver(function(mutations) {
                      for (var i = 0; i < mutations.length; i++) {
                        var m = mutations[i];
                        if (m.type === 'attributes') {
                          cleanDarkReaderAttrs(m.target);
                        } else if (m.type === 'childList') {
                          for (var j = 0; j < m.addedNodes.length; j++) {
                            cleanDarkReaderAttrs(m.addedNodes[j]);
                          }
                        }
                      }
                    });
                    drObserver.observe(document.documentElement, {
                      attributes: true,
                      subtree: true,
                      childList: true,
                      attributeFilter: [
                        'data-darkreader-inline-stroke',
                        'data-darkreader-inline-fill',
                        'data-darkreader-proxy-injected',
                        'style'
                      ]
                    });
                  }
                }
              } catch (_) {}
            `,
          }}
        />
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
