<script lang="ts">
    let {
        label,
        value,
        prev,
        format = 'count',
        goodWhen = 'up',
        hint
    }: {
        label: string;
        /** null renders a dash (no data yet). */
        value: number | null;
        prev?: number;
        format?: 'count' | 'percent';
        /** Which delta direction is colored green. */
        goodWhen?: 'up' | 'down';
        hint?: string;
    } = $props();

    const display = $derived.by(() => {
        if (value === null) return '—';
        return format === 'percent' ? (value * 100).toFixed(1) + '%' : value.toLocaleString();
    });

    const delta = $derived.by(() => {
        if (prev === undefined || value === null) return null;
        if (format === 'percent') {
            const diff = (value - prev) * 100;
            if (Math.abs(diff) < 0.05) return null;
            const sign = diff > 0 ? '+' : '';
            return { text: `${sign}${diff.toFixed(1)}pp`, up: diff > 0 };
        }
        if (prev === 0) return value > 0 ? { text: 'new', up: true } : null;
        const ratio = (value - prev) / prev;
        if (ratio === 0) return null;
        const sign = ratio > 0 ? '+' : '';
        return { text: `${sign}${(ratio * 100).toFixed(0)}%`, up: ratio > 0 };
    });

    const deltaClass = $derived.by(() => {
        if (!delta) return 'text-surface-600-400';
        const good = goodWhen === 'up' ? delta.up : !delta.up;
        return good ? 'text-success-500' : 'text-error-500';
    });
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4" title={hint}>
    <div class="text-surface-600-400 text-xs tracking-wide uppercase">{label}</div>
    <div class="mt-1 flex items-baseline gap-2">
        <span class="text-2xl font-semibold tabular-nums">{display}</span>
        {#if delta}
            <span class={`text-xs font-medium ${deltaClass}`} title="vs. previous window">{delta.text}</span>
        {/if}
    </div>
</div>
