<script lang="ts">
    import { ACTION_GROUPS } from '$lib/util/statsActions.js';
    import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER } from '$lib/util/updateResults.js';
    import { getExplorerHistogram } from '$lib/remote/explorer.remote.js';
    import { localStamp } from '$lib/util/time.js';
    import type { ExplorerQuery } from '$lib/util/explorer.js';

    let { q, qs, onchange }: { q: ExplorerQuery; qs: string; onchange: (next: ExplorerQuery) => void } = $props();

    const h = $derived(await getExplorerHistogram({ qs }));

    // Stack order bottom → top: the noisy groups at the bottom, failures on top
    // where they're easy to spot.
    const ALL_SERIES = [
        ...['appstate', 'lifecycle', 'download', 'resolution', 'channel', 'block', 'failure'].map((k) => {
            const g = ACTION_GROUPS.find((x) => x.key === k)!;
            return { key: g.key, label: g.label, color: g.color };
        }),
        { key: 'other', label: 'Other', color: 'var(--color-surface-500)' },
        { key: 'checks', label: 'Update checks', color: 'var(--color-tertiary-300-700)' },
        ...CATEGORY_ORDER.map((c) => ({ key: 'check:' + c, label: CATEGORY_LABELS[c], color: CATEGORY_COLORS[c] }))
    ];

    const values = $derived.by(() => {
        const m = new Map<string, number>();
        for (const p of h.points) m.set(`${p.t}|${p.key}`, (m.get(`${p.t}|${p.key}`) ?? 0) + p.n);
        return m;
    });
    const present = $derived(new Set(h.points.map((p) => p.key)));
    const series = $derived(ALL_SERIES.filter((s) => present.has(s.key)));
    const val = (b: string, k: string) => values.get(`${b}|${k}`) ?? 0;
    const totals = $derived(h.buckets.map((b) => series.reduce((s, x) => s + val(b, x.key), 0)));
    const max = $derived(Math.max(0, ...totals));
    const grand = $derived(totals.reduce((a, b) => a + b, 0));

    const W = 1000;
    const H = 160;
    const padL = 44;
    const padB = 20;
    const padT = 6;
    const chartW = W - padL - 4;
    const chartH = H - padT - padB;
    const step = $derived(chartW / Math.max(1, h.buckets.length));

    const ticks = $derived.by(() => {
        if (max === 0) return [];
        const raw = max / 3;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const s = Math.max(1, Math.ceil(raw / mag) * mag);
        const out: { y: number; label: string }[] = [];
        for (let v = 0; v <= max; v += s)
            out.push({ y: padT + chartH - (v / max) * chartH, label: v.toLocaleString() });
        return out;
    });

    function bucketLabel(iso: string): string {
        const s = localStamp(iso);
        if (h.bucketSeconds >= 86_400) return s.slice(5, 10);
        if (h.bucketSeconds >= 3600 && h.buckets.length > 30) return s.slice(5, 13) + 'h';
        return s.slice(11, 16);
    }
    const labelEvery = $derived(Math.max(1, Math.ceil(h.buckets.length / 8)));

    // --- drag to zoom ---------------------------------------------------------
    let svg: SVGSVGElement | undefined = $state();
    let dragFrom = $state<number | null>(null);
    let dragTo = $state<number | null>(null);
    let hover = $state<number | null>(null);

    function indexAt(e: PointerEvent): number {
        const r = svg!.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W - padL;
        return Math.max(0, Math.min(h.buckets.length - 1, Math.floor(x / step)));
    }

    function down(e: PointerEvent) {
        if (!h.buckets.length) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        dragFrom = dragTo = indexAt(e);
    }
    function move(e: PointerEvent) {
        if (!h.buckets.length) return;
        const i = indexAt(e);
        hover = i;
        if (dragFrom !== null) dragTo = i;
    }
    function up() {
        if (dragFrom === null || dragTo === null) return;
        const a = Math.min(dragFrom, dragTo);
        const b = Math.max(dragFrom, dragTo);
        dragFrom = dragTo = null;
        const from = h.buckets[a];
        const to = new Date(new Date(h.buckets[b]).getTime() + h.bucketSeconds * 1000).toISOString();
        // A single click on one bar zooms into that bar.
        onchange({ ...q, range: 'custom', from, to });
    }

    const sel = $derived(
        dragFrom !== null && dragTo !== null
            ? { x: padL + Math.min(dragFrom, dragTo) * step, w: (Math.abs(dragTo - dragFrom) + 1) * step }
            : null
    );

    const hoverInfo = $derived.by(() => {
        if (hover === null || dragFrom !== null) return null;
        const b = h.buckets[hover];
        if (!b) return null;
        const parts = series
            .map((s) => ({ ...s, n: val(b, s.key) }))
            .filter((s) => s.n > 0)
            .toReversed();
        return { b, total: totals[hover], parts };
    });

    function bucketSpan(iso: string): string {
        const end = new Date(new Date(iso).getTime() + h.bucketSeconds * 1000).toISOString();
        return `${localStamp(iso).slice(0, 16)} – ${localStamp(end).slice(11, 16)}`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span class="text-surface-600-400">
            {grand.toLocaleString()} rows · {h.bucketSeconds >= 3600
                ? `${h.bucketSeconds / 3600}h`
                : `${h.bucketSeconds / 60}min`} buckets · drag to zoom
        </span>
        {#if hoverInfo}
            <span class="tabular-nums">
                <strong>{bucketSpan(hoverInfo.b)}</strong> · {hoverInfo.total.toLocaleString()}
                {#each hoverInfo.parts.slice(0, 4) as p}
                    <span class="ml-2 inline-flex items-center gap-1"
                        ><span class="inline-block size-2 rounded-sm" style:background={p.color}></span>{p.label}
                        {p.n.toLocaleString()}</span
                    >
                {/each}
            </span>
        {/if}
    </div>
    {#if max === 0}
        <p class="text-surface-600-400 py-10 text-center text-sm">Nothing in this window.</p>
    {:else}
        <svg
            bind:this={svg}
            viewBox="0 0 {W} {H}"
            class="h-40 w-full cursor-crosshair touch-none select-none"
            preserveAspectRatio="none"
            role="img"
            aria-label="Rows over time"
            onpointerdown={down}
            onpointermove={move}
            onpointerup={up}
            onpointerleave={() => (hover = null)}
        >
            {#each ticks as t}
                <line x1={padL} x2={W} y1={t.y} y2={t.y} stroke="var(--color-surface-300-700)" stroke-dasharray="2 4" />
                <text x={padL - 6} y={t.y + 3} text-anchor="end" font-size="10" fill="var(--color-surface-600-400)"
                    >{t.label}</text
                >
            {/each}
            {#each h.buckets as b, i}
                {@const x = padL + i * step + step * 0.1}
                {@const w = Math.max(step * 0.8, 1)}
                {#if hover === i}
                    <rect
                        x={padL + i * step}
                        y={padT}
                        width={step}
                        height={chartH}
                        fill="var(--color-surface-500)"
                        opacity="0.15"
                    />
                {/if}
                {#each series as s, si (s.key)}
                    {@const below = series.slice(0, si).reduce((acc, x) => acc + val(b, x.key), 0)}
                    {@const n = val(b, s.key)}
                    {#if n > 0}
                        <rect
                            {x}
                            y={padT + chartH - ((below + n) / max) * chartH}
                            width={w}
                            height={(n / max) * chartH}
                            fill={s.color}
                        />
                    {/if}
                {/each}
                {#if i % labelEvery === 0}
                    <text
                        x={padL + (i + 0.5) * step}
                        y={H - 5}
                        text-anchor="middle"
                        font-size="10"
                        fill="var(--color-surface-600-400)">{bucketLabel(b)}</text
                    >
                {/if}
            {/each}
            {#if sel}
                <rect x={sel.x} y={padT} width={sel.w} height={chartH} fill="var(--color-primary-500)" opacity="0.2" />
            {/if}
        </svg>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {#each series.toReversed() as s (s.key)}
                <span class="inline-flex items-center gap-1.5">
                    <span class="inline-block size-2.5 rounded-sm" style:background={s.color}></span>{s.label}
                </span>
            {/each}
        </div>
    {/if}
</div>
