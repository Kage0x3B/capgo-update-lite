<script module lang="ts">
    export type Series = { key: string; label: string; color: string };
</script>

<script lang="ts">
    let {
        buckets,
        series,
        value,
        unit = 'devices'
    }: {
        /** Bucket starts (ISO), oldest first. Every bucket gets a slot, empty or not. */
        buckets: string[];
        /** Stack order, bottom first. Also the legend order. */
        series: Series[];
        /** Value of one series in one bucket. */
        value: (bucket: string, key: string) => number;
        unit?: string;
    } = $props();

    const width = 700;
    const height = 220;
    const padL = 40;
    const padR = 8;
    const padT = 8;
    const padB = 24;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const hourly = $derived.by(() => {
        if (buckets.length < 2) return false;
        return new Date(buckets[1]).getTime() - new Date(buckets[0]).getTime() < 86_400_000;
    });

    const totals = $derived(buckets.map((b) => series.reduce((s, x) => s + value(b, x.key), 0)));
    const maxTotal = $derived(Math.max(0, ...totals));

    const columns = $derived.by(() => {
        if (buckets.length === 0 || maxTotal === 0) return [];
        const step = chartW / buckets.length;
        const barW = Math.max(step * 0.8, 1);
        return buckets.map((bucket, i) => {
            let y = padT + chartH;
            const segments = [];
            for (const s of series) {
                const n = value(bucket, s.key);
                if (n === 0) continue;
                const h = (n / maxTotal) * chartH;
                y -= h;
                segments.push({ y, h, color: s.color, label: s.label, n });
            }
            return { x: padL + i * step + (step - barW) / 2, w: barW, bucket, total: totals[i], segments };
        });
    });

    const yTicks = $derived.by(() => {
        if (maxTotal === 0) return [];
        const raw = maxTotal / 4;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = Math.max(1, Math.ceil(raw / mag) * mag);
        const ticks: Array<{ y: number; label: string }> = [];
        for (let v = 0; v <= maxTotal; v += step) {
            ticks.push({ y: padT + chartH - (v / maxTotal) * chartH, label: v.toLocaleString() });
        }
        return ticks;
    });

    function fmtBucket(iso: string): string {
        return hourly ? iso.slice(11, 16) : iso.slice(5, 10);
    }

    function fmtTitle(iso: string): string {
        return hourly ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : iso.slice(0, 10);
    }

    function tooltip(col: { bucket: string; total: number; segments: { label: string; n: number }[] }): string {
        const lines = col.segments.toReversed().map((seg) => `${seg.label}: ${seg.n.toLocaleString()}`);
        return [`${fmtTitle(col.bucket)} · ${col.total.toLocaleString()} ${unit}`, ...lines].join('\n');
    }

    // Show at most ~7 x labels so they never collide.
    const labelEvery = $derived(Math.max(1, Math.ceil(buckets.length / 7)));
</script>

{#if maxTotal === 0}
    <p class="text-surface-600-400 py-8 text-center text-sm">No data in this window.</p>
{:else}
    <svg viewBox={`0 0 ${width} ${height}`} class="w-full" preserveAspectRatio="none" role="img">
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

        {#each columns as col}
            <g>
                <title>{tooltip(col)}</title>
                <!-- Full-height hit area so the tooltip works on short bars too. -->
                <rect x={col.x} y={padT} width={col.w} height={chartH} fill="transparent" />
                {#each col.segments as seg}
                    <rect x={col.x} y={seg.y} width={col.w} height={seg.h} fill={seg.color} />
                {/each}
            </g>
        {/each}

        {#each buckets as bucket, i}
            {#if i % labelEvery === 0}
                <text
                    x={padL + (i + 0.5) * (chartW / buckets.length)}
                    y={height - 8}
                    text-anchor="middle"
                    font-size="10"
                    fill="var(--color-surface-600-400)"
                >
                    {fmtBucket(bucket)}
                </text>
            {/if}
        {/each}
    </svg>

    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {#each series.toReversed() as s (s.key)}
            <span class="inline-flex items-center gap-1.5">
                <span class="inline-block h-2.5 w-2.5 rounded-sm" style:background={s.color}></span>
                <span>{s.label}</span>
            </span>
        {/each}
    </div>
{/if}
