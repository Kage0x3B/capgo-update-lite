<script lang="ts">
    import { getExplorerFacets } from '$lib/remote/explorer.remote.js';
    import { actionGroup } from '$lib/util/statsActions.js';
    import { CATEGORY_COLORS, resultInfo } from '$lib/util/updateResults.js';
    import {
        DIM_BY_KEY,
        valueLabel,
        withoutValue,
        withValue,
        type DimKey,
        type ExplorerQuery,
        type Facets
    } from '$lib/util/explorer.js';

    let { q, qs, onchange }: { q: ExplorerQuery; qs: string; onchange: (next: ExplorerQuery) => void } = $props();

    const facets: Facets = $derived(await getExplorerFacets({ qs }));

    // Order: the questions people ask first.
    const ORDER: DimKey[] = [
        'action',
        'result',
        'version',
        'bundle',
        'native',
        'platform',
        'os',
        'channel',
        'plugin',
        'country',
        'device'
    ];
    const dims = $derived(ORDER.filter((d) => (facets[d]?.length ?? 0) > 0));

    function color(dim: DimKey, value: string): string {
        if (dim === 'action') return actionGroup(value)?.color ?? 'var(--color-surface-500)';
        if (dim === 'result') return CATEGORY_COLORS[resultInfo(value).category];
        return 'var(--color-primary-500)';
    }

    function state(dim: DimKey, value: string): 'in' | 'out' | null {
        const f = q.dims[dim];
        if (f?.in.includes(value)) return 'in';
        if (f?.out.includes(value)) return 'out';
        return null;
    }

    function click(e: MouseEvent, dim: DimKey, value: string) {
        const s = state(dim, value);
        const exclude = e.altKey || e.shiftKey;
        if ((s === 'in' && !exclude) || (s === 'out' && exclude)) onchange(withoutValue(q, dim, value));
        else onchange(withValue(q, dim, value, exclude ? 'out' : 'in'));
    }
</script>

<div class="space-y-4">
    <p class="text-surface-600-400 text-xs">Click to filter. Alt-click to exclude.</p>
    {#each dims as dim (dim)}
        {@const rows = facets[dim]!}
        {@const max = Math.max(1, ...rows.map((r) => r.n))}
        <section>
            <h3 class="text-surface-600-400 mb-1 text-xs font-semibold tracking-wide uppercase">
                {DIM_BY_KEY.get(dim)?.label}
            </h3>
            <ul class="space-y-0.5">
                {#each rows as r (r.value)}
                    {@const s = state(dim, r.value)}
                    <li>
                        <button
                            type="button"
                            class="group hover:bg-surface-200-800 relative flex w-full items-center gap-2 overflow-hidden rounded px-1.5 py-0.5 text-left text-xs {s ===
                            'in'
                                ? 'ring-primary-500 ring-1'
                                : s === 'out'
                                  ? 'opacity-50'
                                  : ''}"
                            title="{r.value}: {r.n.toLocaleString()} rows, {r.devices.toLocaleString()} devices"
                            onclick={(e) => click(e, dim, r.value)}
                        >
                            <span
                                class="absolute inset-y-0 left-0 opacity-15"
                                style:width="{(r.n / max) * 100}%"
                                style:background={color(dim, r.value)}
                            ></span>
                            <span class="relative min-w-0 flex-1 truncate {s === 'out' ? 'line-through' : ''}"
                                >{valueLabel(dim, r.value)}</span
                            >
                            <span class="text-surface-600-400 relative shrink-0 tabular-nums"
                                >{r.n.toLocaleString()}</span
                            >
                        </button>
                    </li>
                {/each}
            </ul>
        </section>
    {/each}
</div>
