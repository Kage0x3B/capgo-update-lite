<script lang="ts">
    import { getExplorerGroups } from '$lib/remote/explorer.remote.js';
    import { DIM_BY_KEY, valueLabel, withValue, type DimKey, type ExplorerQuery } from '$lib/util/explorer.js';
    import { fmtTime, localStamp, type TimeMode } from '$lib/util/time.js';

    let {
        q,
        qs,
        by,
        timeMode,
        onchange
    }: { q: ExplorerQuery; qs: string; by: DimKey; timeMode: TimeMode; onchange: (next: ExplorerQuery) => void } =
        $props();

    const groups = $derived(await getExplorerGroups({ qs, dim: by }));
    const max = $derived(Math.max(1, ...groups.map((g) => g.n)));
    const total = $derived(groups.reduce((s, g) => s + g.n, 0));
</script>

{#if groups.length === 0}
    <div class="card preset-filled-surface-100-900 text-surface-600-400 p-8 text-center text-sm">
        Nothing matches. Widen the time range or remove a filter.
    </div>
{:else}
    <div class="table-wrap">
        <table class="table text-sm">
            <thead>
                <tr>
                    <th>{DIM_BY_KEY.get(by)?.label}</th>
                    <th class="w-1/3">Rows</th>
                    <th class="text-right">Devices</th>
                    <th>First</th>
                    <th>Last</th>
                </tr>
            </thead>
            <tbody>
                {#each groups as g (g.value)}
                    <tr
                        class="hover:bg-surface-200-800/60 cursor-pointer"
                        title="Click: show only these rows"
                        onclick={() => onchange(withValue(q, by, g.value, 'in'))}
                    >
                        <td class="font-mono text-xs break-all" title={g.value}>
                            {by === 'device' ? g.value : valueLabel(by, g.value)}
                        </td>
                        <td>
                            <div class="flex items-center gap-2">
                                <div class="bg-surface-200-800 h-2 min-w-0 flex-1 overflow-hidden rounded">
                                    <div class="bg-primary-500 h-full" style:width="{(g.n / max) * 100}%"></div>
                                </div>
                                <span class="w-20 text-right text-xs tabular-nums">
                                    {g.n.toLocaleString()}
                                    <span class="text-surface-600-400">{((g.n / total) * 100).toFixed(0)}%</span>
                                </span>
                            </div>
                        </td>
                        <td class="text-right text-xs tabular-nums">{g.devices.toLocaleString()}</td>
                        <td class="text-surface-600-400 font-mono text-xs whitespace-nowrap" title={localStamp(g.first)}
                            >{fmtTime(g.first, timeMode)}</td
                        >
                        <td class="text-surface-600-400 font-mono text-xs whitespace-nowrap" title={localStamp(g.last)}
                            >{fmtTime(g.last, timeMode)}</td
                        >
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
    <p class="text-surface-600-400 mt-2 text-xs">Top {groups.length} groups by row count.</p>
{/if}
