<script lang="ts">
    type Point = { t: string; count: number };
    let { data }: { data: Point[] } = $props();

    const width = 700;
    const height = 80;
    const padL = 4;
    const padR = 4;
    const padT = 10;
    const padB = 16;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const sorted = $derived([...data].sort((a, b) => a.t.localeCompare(b.t)));
    const maxCount = $derived(Math.max(1, ...sorted.map((p) => p.count)));
    const total = $derived(sorted.reduce((s, p) => s + p.count, 0));

    const path = $derived.by(() => {
        if (sorted.length === 0) return '';
        const step = chartW / Math.max(1, sorted.length - 1);
        return sorted
            .map((p, i) => {
                const x = padL + i * step;
                const y = padT + chartH - (p.count / maxCount) * chartH;
                return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');
    });

    const area = $derived.by(() => {
        if (!path) return '';
        const step = chartW / Math.max(1, sorted.length - 1);
        const lastX = padL + (sorted.length - 1) * step;
        return `${path} L ${lastX.toFixed(1)} ${padT + chartH} L ${padL} ${padT + chartH} Z`;
    });
</script>

<div class="card preset-filled-surface-100-900 p-4">
    <div class="mb-3 flex items-baseline justify-between">
        <h3 class="h5">Update checks</h3>
        <span class="text-surface-600-400 text-xs">{total.toLocaleString()} total · set + noNew + missingBundle</span>
    </div>
    {#if sorted.length === 0}
        <p class="text-surface-600-400 py-4 text-center text-sm">No update-check activity.</p>
    {:else}
        <svg viewBox={`0 0 ${width} ${height}`} class="w-full" preserveAspectRatio="none">
            <path d={area} fill="var(--color-primary-500)" fill-opacity="0.15" />
            <path
                d={path}
                fill="none"
                stroke="var(--color-primary-500)"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            {#each sorted as p, i}
                {@const step = chartW / Math.max(1, sorted.length - 1)}
                {@const cx = padL + i * step}
                {@const cy = padT + chartH - (p.count / maxCount) * chartH}
                {#if p.count > 0}
                    <circle {cx} {cy} r="2" fill="var(--color-primary-500)">
                        <title>{p.t}: {p.count}</title>
                    </circle>
                {/if}
            {/each}
        </svg>
    {/if}
</div>
