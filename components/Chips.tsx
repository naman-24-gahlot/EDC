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
      <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#8A97A6]">{label}</span>
      {options.map(([value, text, count]) => {
        const on = value === current;
        return (
          <Link key={value} href={href(value)} scroll={false} aria-current={on ? 'true' : undefined}
            className={`chip ${on ? 'chip-on' : ''}`}>
            {text}{count !== undefined && <span className="font-mono text-[11px] tabular-nums opacity-60">{count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
