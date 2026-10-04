'use client';

import { useToast } from './toast';
import { Icon } from './Icon';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for plain http
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const toast = useToast();
  async function copy() {
    if (await copyToClipboard(code)) toast.success(`${label} copied.`);
    else toast.error('Could not copy. Select the text and copy it manually.');
  }
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-[#0d0d10] p-4 pr-24 font-mono text-xs leading-relaxed text-slate-100">
        {code}
      </pre>
      <button
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/10"
      >
        <Icon name="copy" className="h-3.5 w-3.5" /> Copy
      </button>
    </div>
  );
}
