<script lang="ts">
    import StackedBars, { type Series } from './StackedBars.svelte';
    import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER, resultInfo } from '$lib/util/updateResults.js';

    type Outcomes = { buckets: string[]; points: { t: string; result: string; checks: number }[] };
    let { data, title = 'Update checks' }: { data: Outcomes; title?: string } = $props();

    const byCategory = $derived.by(() => {
        const m = new Map<string, number>();
        for (const p of data.points) {
            const key = `${p.t}|${resultInfo(p.result).category}`;
            m.set(key, (m.get(key) ?? 0) + p.checks);
        }
        return m;
    });

    const total = $derived(data.points.reduce((s, p) => s + p.checks, 0));

    const series = $derived<Series[]>(
        CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABELS[c], color: CATEGORY_COLORS[c] }))
    );
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">{title}</h3>
        <span class="text-surface-600-400 text-xs"
            >{total.toLocaleString()} calls to /updates, by what the server answered</span
        >
    </div>
    {#if total === 0}
        <p class="text-surface-600-400 py-8 text-center text-sm">
            No update checks recorded yet. They are logged from this server version on.
        </p>
    {:else}
        <StackedBars buckets={data.buckets} {series} unit="checks" value={(t, c) => byCategory.get(`${t}|${c}`) ?? 0} />
    {/if}
</div>
