<script lang="ts">
    type Row = { platform: string; devices: number };
    let { data }: { data: Row[] } = $props();

    const COLORS: Record<string, string> = {
        ios: 'var(--color-primary-500)',
        android: 'var(--color-success-500)',
        electron: 'var(--color-tertiary-500)',
        unknown: 'var(--color-surface-400-600)'
    };

    const total = $derived(data.reduce((s, r) => s + r.devices, 0));

    const arcs = $derived.by(() => {
        if (total === 0) return [];
        const r = 58;
        const cx = 80;
        const cy = 80;
        let a0 = -Math.PI / 2;
        return data.map((row) => {
            const frac = row.devices / total;
            const a1 = a0 + frac * Math.PI * 2;
            const large = frac > 0.5 ? 1 : 0;
            const x0 = cx + r * Math.cos(a0);
            const y0 = cy + r * Math.sin(a0);
            const x1 = cx + r * Math.cos(a1);
            const y1 = cy + r * Math.sin(a1);
            const d =
                frac === 1
                    ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r - 0.01} ${cy} Z`
                    : `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
            a0 = a1;
            return { d, fill: COLORS[row.platform] ?? 'var(--color-surface-400-600)', row, frac };
        });
    });
</script>

<div class="card preset-filled-surface-100-900 p-4">
    <h3 class="h5 mb-3">Platform split</h3>

    {#if total === 0}
        <p class="text-surface-600-400 py-6 text-center text-sm">No devices in window.</p>
    {:else}
        <div class="flex items-center gap-6">
            <svg viewBox="0 0 160 160" width="160" height="160" class="shrink-0">
                {#each arcs as a}
                    <path d={a.d} fill={a.fill}>
                        <title>{a.row.platform}: {a.row.devices}</title>
                    </path>
                {/each}
                <circle cx="80" cy="80" r="30" fill="var(--color-surface-100-900)" />
                <text
                    x="80"
                    y="78"
                    text-anchor="middle"
                    font-size="18"
                    font-weight="600"
                    fill="var(--color-surface-950-50)"
                >
                    {total}
                </text>
                <text x="80" y="94" text-anchor="middle" font-size="9" fill="var(--color-surface-600-400)">
                    devices
                </text>
            </svg>

            <ul class="space-y-1.5 text-sm">
                {#each arcs as a}
                    <li class="flex items-center gap-2">
                        <span class="inline-block h-3 w-3 rounded-sm" style:background={a.fill}></span>
                        <span class="w-16">{a.row.platform}</span>
                        <span class="text-surface-600-400 tabular-nums">
                            {a.row.devices} <span class="text-xs">({(a.frac * 100).toFixed(0)}%)</span>
                        </span>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}
</div>
