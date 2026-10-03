'use client';

import React, { useState } from 'react';
import { Copy, Check, Play, Terminal, GitCompare } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';

interface MarkdownRendererProps {
  content: string;
  onExecuteCommand?: (cmd: string) => void;
  onReviewManifest?: (rawYaml: string) => void;
}

export function MarkdownRenderer({ content, onExecuteCommand, onReviewManifest }: MarkdownRendererProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (code: string, idx: number) => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  // Parse markdown into blocks
  const renderBlocks = () => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    let codeBlockCounter = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced Code Block
      if (line.trim().startsWith('```')) {
        const langMatch = line.trim().match(/^```([a-zA-Z0-9_-]*)/);
        const language = langMatch ? langMatch[1] : '';
        const codeLines: string[] = [];
        i++;

        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```

        const fullCode = codeLines.join('\n');
        const currentIndex = codeBlockCounter++;

        // Determine if this is a runnable CLI command
        const trimmedCode = fullCode.trim();
        const firstLine = trimmedCode.split('\n')[0].replace(/^[$#]\s*/, '').trim();
        const isRunnable =
          (language === 'bash' || language === 'sh' || language === '') &&
          (firstLine.startsWith('kubectl ') ||
            firstLine.startsWith('helm ') ||
            firstLine.startsWith('argocd ') ||
            firstLine.startsWith('flux ') ||
            firstLine.startsWith('./up') ||
            firstLine.startsWith('k3s ') ||
            firstLine.startsWith('docker '));

        const isManifest =
          (language === 'yaml' || language === 'yml' || language === '') &&
          (trimmedCode.includes('kind:') ||
            trimmedCode.includes('apiVersion:') ||
            (trimmedCode.includes('spec:') && trimmedCode.includes('metadata:')));

        elements.push(
          <div
            key={`code-${currentIndex}`}
            className="my-3 rounded-lg border border-slate-800 bg-slate-950 overflow-hidden shadow-sm"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400 font-mono">
              <span className="font-semibold text-slate-300">
                {language || 'code'}
              </span>
              <div className="flex items-center space-x-2">
                {isManifest && onReviewManifest && (
                  <button
                    onClick={() => onReviewManifest(fullCode)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-[10px] transition-colors shadow-sm"
                    title="Review and apply this manifest patch to cluster overrides"
                  >
                    <GitCompare className="w-2.5 h-2.5" />
                    <span>Review & Apply Patch</span>
                  </button>
                )}
                {isRunnable && onExecuteCommand && (
                  <button
                    onClick={() => onExecuteCommand(firstLine)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-sans text-[10px] transition-colors"
                    title={`Run: ${firstLine}`}
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>Run Command</span>
                  </button>
                )}
                <button
                  onClick={() => handleCopy(fullCode, currentIndex)}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  {copiedIndex === currentIndex ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <pre className="p-3 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
              <code>{fullCode}</code>
            </pre>
          </div>
        );
        continue;
      }

      // Markdown Table
      if (line.includes('|') && lines[i + 1] && lines[i + 1].includes('|') && lines[i + 1].includes('-')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(lines[i]);
          i++;
        }

        const parseCells = (row: string) =>
          row
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());

        const headers = parseCells(tableLines[0]);
        const rows = tableLines.slice(2).map(parseCells);

        elements.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 border-b border-slate-800 text-slate-300 font-semibold">
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="px-3 py-2">
                      {renderInlineText(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                {rows.map((r, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-900/40">
                    {r.map((c, cIdx) => (
                      <td key={cIdx} className="px-3 py-2 text-slate-300">
                        {renderInlineText(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // Headers
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${i}`} className="text-lg font-bold text-slate-100 mt-4 mb-2">
            {renderInlineText(line.replace('# ', ''))}
          </h1>
        );
        i++;
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${i}`} className="text-base font-bold text-slate-100 mt-3 mb-2 border-b border-slate-800/80 pb-1">
            {renderInlineText(line.replace('## ', ''))}
          </h2>
        );
        i++;
        continue;
      }
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${i}`} className="text-sm font-semibold text-slate-200 mt-3 mb-1.5 flex items-center space-x-2">
            {renderInlineText(line.replace('### ', ''))}
          </h3>
        );
        i++;
        continue;
      }
      if (line.startsWith('#### ')) {
        elements.push(
          <h4 key={`h4-${i}`} className="text-xs font-semibold text-sky-400 uppercase tracking-wider mt-2.5 mb-1">
            {renderInlineText(line.replace('#### ', ''))}
          </h4>
        );
        i++;
        continue;
      }

      // Blockquotes
      if (line.startsWith('> ')) {
        elements.push(
          <blockquote
            key={`quote-${i}`}
            className="my-2 border-l-2 border-sky-500 bg-sky-950/20 px-3 py-1.5 rounded-r text-xs text-slate-300 italic"
          >
            {renderInlineText(line.replace('> ', ''))}
          </blockquote>
        );
        i++;
        continue;
      }

      // Unordered lists
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const listItems: string[] = [];
        while (
          i < lines.length &&
          (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))
        ) {
          listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''));
          i++;
        }
        elements.push(
          <ul key={`ul-${i}`} className="my-2 space-y-1 pl-4 list-disc text-xs text-slate-300">
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {renderInlineText(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered lists
      if (/^\d+\.\s/.test(line.trim())) {
        const listItems: string[] = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        elements.push(
          <ol key={`ol-${i}`} className="my-2 space-y-1 pl-4 list-decimal text-xs text-slate-300">
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {renderInlineText(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Blank line
      if (!line.trim()) {
        i++;
        continue;
      }

      // Normal paragraph
      elements.push(
        <p key={`p-${i}`} className="my-1.5 text-xs text-slate-300 leading-relaxed">
          {renderInlineText(line)}
        </p>
      );
      i++;
    }

    return elements;
  };

  return <div className="space-y-1">{renderBlocks()}</div>;
}

/**
 * Handles inline markdown: bold (**), italic (*), inline code (`), and links [text](url).
 */
function renderInlineText(text: string): React.ReactNode[] {
  // Regex tokenization for inline formatting
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, index) => {
    if (!token) return null;

    // Inline code: `code`
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      const code = token.slice(1, -1);
      return (
        <code
          key={index}
          className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[11px] border border-slate-700/60"
        >
          {code}
        </code>
      );
    }

    // Bold: **text**
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={index} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>
      );
    }

    // Italic: *text*
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      return (
        <em key={index} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    }

    // Links: [label](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
          target={linkMatch[2].startsWith('http') ? '_blank' : undefined}
          rel={linkMatch[2].startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <React.Fragment key={index}>{token}</React.Fragment>;
  });
}
