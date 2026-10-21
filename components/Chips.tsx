import Link from 'next/link';

export type ChipOption = readonly [value: string, label: string, count?: number];

/**
 * A row of link "chips" that set one query parameter, keeping the others — filters, sort order
 * and view mode all use it, so every choice is a shareable URL and works without JavaScript.
 * Changing a chip returns paging to page 1.
 */
export function Chips({ label, param, options, current, path, params, pageParam = 'page' }: {
  label: string;
  param: string;
  options: readonly ChipOption[];
  current: string;
  path: string;
  params: Record<string, string | undefined>;
  pageParam?: string;
}) {
  const href = (value: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== param && k !== pageParam) q.set(k, v);
    if (value !== options[0][0]) q.set(param, value); // first option is the default — keep URLs short
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {options.map(([value, text, count]) => {
        const on = value === current;
        return (
          <Link key={value} href={href(value)} scroll={false} aria-current={on ? 'true' : undefined}
            className={`inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium md:min-h-7 ${on ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50'}`}>
            {text}{count !== undefined && <span className={on ? 'text-gray-300' : 'text-gray-400'}>{count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
