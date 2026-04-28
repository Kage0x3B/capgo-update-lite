<script lang="ts">
    type Point = { t: string; version: string; devices: number };
    let { data }: { data: Point[] } = $props();

    const PALETTE = [
        'var(--color-primary-500)',
        'var(--color-secondary-500)',
        'var(--color-tertiary-500)',
        'var(--color-success-500)',
        'var(--color-warning-500)',
        'var(--color-error-500)'
    ];

    // Pivot data: { ts: { version: devices } }
    const pivoted = $derived.by(() => {
        const byTs = new Map<string, Map<string, number>>();
        const versions = new Set<string>();
        for (const p of data) {
            versions.add(p.version);
            let row = byTs.get(p.t);
            if (!row) byTs.set(p.t, (row = new Map()));
            row.set(p.version, (row.get(p.version) ?? 0) + p.devices);
        }
        const sortedTs = Array.from(byTs.keys()).sort();
        const sortedVersions = Array.from(versions).sort();
        return { byTs, sortedTs, sortedVersions };
    });

    const maxTotal = $derived.by(() => {
        let m = 0;
        for (const row of pivoted.byTs.values()) {
            let sum = 0;
            for (const v of row.values()) sum += v;
            if (sum > m) m = sum;
        }
        return m;
    });

    const width = 700;
    const height = 220;
    const padL = 36;
    const padR = 8;
    const padT = 8;
    const padB = 28;
    const chartW = $derived(width - padL - padR);
    const chartH = $derived(height - padT - padB);

    const bars = $derived.by(() => {
        if (pivoted.sortedTs.length === 0 || maxTotal === 0) return [];
        const step = chartW / pivoted.sortedTs.length;
        const barW = Math.max(step * 0.8, 1);
        const result: Array<{
            x: number;
            y: number;
            w: number;
            h: number;
            fill: string;
            version: string;
            devices: number;
        }> = [];
        pivoted.sortedTs.forEach((ts, i) => {
            const row = pivoted.byTs.get(ts)!;
            let yOffset = 0;
            pivoted.sortedVersions.forEach((version, vi) => {
                const devices = row.get(version) ?? 0;
                if (devices === 0) return;
                const h = (devices / maxTotal) * chartH;
                yOffset += h;
                result.push({
                    x: padL + i * step + (step - barW) / 2,
                    y: padT + chartH - yOffset,
                    w: barW,
                    h,
                    fill: PALETTE[vi % PALETTE.length],
                    version,
                    devices
                });
            });
        });
        return result;
    });

    function formatTick(ts: string): string {
        const d = new Date(ts);
        return d.toISOString().slice(5, 10); // MM-DD
    }

    const yTicks = $derived.by(() => {
        if (maxTotal === 0) return [{ y: padT + chartH, label: '0' }];
        const step = Math.max(1, Math.ceil(maxTotal / 4));
        const ticks: Array<{ y: number; label: string }> = [];
        for (let v = 0; v <= maxTotal; v += step) {
            ticks.push({ y: padT + chartH - (v / maxTotal) * chartH, label: v.toString() });
        }
        return ticks;
    });
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">Adoption by version</h3>
        <span class="text-surface-600-400 text-xs">Distinct devices emitting `set`</span>
    </div>

    {#if data.length === 0}
        <p class="text-surface-600-400 py-8 text-center text-sm">No adoption data yet.</p>
    {:else}
        <svg viewBox={`0 0 ${width} ${height}`} class="w-full" preserveAspectRatio="none">
            <!-- y gridlines -->
            {#each yTicks as tick}
                <line
                    x1={padL}
                    x2={width - padR}
                    y1={tick.y}
                    y2={tick.y}
                    stroke="var(--color-surface-300-700)"
                    stroke-width="1"
                    stroke-dasharray="2 4"
                />
                <text x={padL - 6} y={tick.y + 3} text-anchor="end" font-size="10" fill="var(--color-surface-600-400)">
                    {tick.label}
                </text>
            {/each}

            <!-- bars -->
            {#each bars as bar}
                <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} fill={bar.fill}>
                    <title>{bar.version}: {bar.devices}</title>
                </rect>
            {/each}

            <!-- x labels -->
            {#each pivoted.sortedTs as ts, i}
                {#if i === 0 || i === pivoted.sortedTs.length - 1 || i === Math.floor(pivoted.sortedTs.length / 2)}
                    <text
                        x={padL + (i + 0.5) * (chartW / pivoted.sortedTs.length)}
                        y={height - 10}
                        text-anchor="middle"
                        font-size="10"
                        fill="var(--color-surface-600-400)"
                    >
                        {formatTick(ts)}
                    </text>
                {/if}
            {/each}
        </svg>

        <!-- Legend -->
        <div class="mt-2 flex flex-wrap gap-3 text-xs">
            {#each pivoted.sortedVersions as version, i}
                <span class="inline-flex items-center gap-1.5">
                    <span class="inline-block h-2.5 w-2.5 rounded-sm" style:background={PALETTE[i % PALETTE.length]}
                    ></span>
                    <code>{version}</code>
                </span>
            {/each}
        </div>
    {/if}
</div>
