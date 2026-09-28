/**
 * Safe clipboard copy with fallback for non-secure contexts (HTTP),
 * iframes, or browsers where navigator.clipboard is not supported or permitted.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Try modern async Clipboard API if available and in secure context
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }

  // 2. Fallback to document.execCommand('copy') via temporary textarea
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    (document.body || document.documentElement).appendChild(textarea);
    textarea.focus();
    textarea.select();
    if (textarea.setSelectionRange) {
      textarea.setSelectionRange(0, textarea.value.length);
    }
    const successful = document.execCommand('copy');
    (document.body || document.documentElement).removeChild(textarea);
    return successful;
  } catch {
    return false;
  }
}
