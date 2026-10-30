<script lang="ts">
    type Row = { label: string; devices: number; group?: string };
    let {
        title,
        rows,
        empty = 'No data yet.',
        color = 'var(--color-secondary-500)',
        note
    }: { title: string; rows: Row[]; empty?: string; color?: string; note?: string } = $props();

    const maxDevices = $derived(Math.max(1, ...rows.map((r) => r.devices)));
    // Percentages are relative to the row's group (e.g. per platform).
    const groupTotals = $derived.by(() => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.group ?? '', (m.get(r.group ?? '') ?? 0) + r.devices);
        return m;
    });
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">{title}</h3>
        {#if note}<span class="text-surface-600-400 text-xs">{note}</span>{/if}
    </div>
    {#if rows.length === 0}
        <p class="text-surface-600-400 py-6 text-center text-sm">{empty}</p>
    {:else}
        <div class="space-y-1.5 text-sm">
            {#each rows as row, i}
                {#if row.group && row.group !== rows[i - 1]?.group}
                    <div class="text-surface-600-400 pt-1 text-xs tracking-wide uppercase">{row.group}</div>
                {/if}
                {@const w = (row.devices / maxDevices) * 100}
                <div class="flex items-center gap-3" title="{row.label}: {row.devices} devices">
                    <code class="w-24 shrink-0 truncate text-xs">{row.label}</code>
                    <div class="bg-surface-200-800 relative h-5 min-w-0 flex-1 overflow-hidden rounded">
                        <div class="h-full" style:width="{w}%" style:background={color}></div>
                    </div>
                    <span class="text-surface-600-400 w-16 shrink-0 text-right text-xs tabular-nums">
                        {row.devices}
                        <span class="text-[10px]"
                            >({((row.devices / (groupTotals.get(row.group ?? '') || 1)) * 100).toFixed(0)}%)</span
                        >
                    </span>
                </div>
            {/each}
        </div>
    {/if}
</div>
