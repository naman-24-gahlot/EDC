'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TreeBranch, TreeNode } from '@/lib/hierarchy/treeNode';

// A person in the hierarchy. Employees and Masters can be opened to show the people under them,
// fetched then (/api/admin/hierarchy) — or given up front when the whole tree was asked for.
export function Branch({ node, kids: initialKids }: TreeBranch) {
  const [kids, setKids] = useState<TreeBranch[] | null>(initialKids ?? null);
  const [open, setOpen] = useState(!!initialKids);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (kids) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/hierarchy?parent=${encodeURIComponent(node.personId)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Could not load.');
      setKids(((await r.json()).kids as TreeNode[]).map((n) => ({ node: n })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2 py-0.5" data-node={node.username}>
        {node.canHaveKids && !initialKids && (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} people under ${node.name}`}
            className="inline-flex min-h-8 w-6 items-center justify-center text-xs text-gray-500">{loading ? '…' : open ? '▾' : '▸'}</button>
        )}
        <Link href={`/admin/people/${node.personId}`} className="text-sm font-medium hover:underline">{node.name}</Link>
        <span className="text-xs text-gray-500">{node.meta}</span>
        {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
      </div>
      {open && kids && (kids.length === 0
        ? (!initialKids && <p className="ml-9 text-xs text-gray-400">Nobody under them.</p>)
        : (
          <ul className="ml-3 border-l border-gray-200 pl-4">
            {kids.map((k) => <Branch key={k.node.personId} node={k.node} kids={k.kids} />)}
          </ul>
        ))}
    </li>
  );
}
