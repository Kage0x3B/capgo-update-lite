<script lang="ts">
    let {
        label,
        value,
        prev,
        format = 'count'
    }: {
        label: string;
        value: number;
        prev?: number;
        format?: 'count' | 'percent';
    } = $props();

    const display = $derived(format === 'percent' ? (value * 100).toFixed(1) + '%' : value.toLocaleString());

    const delta = $derived.by(() => {
        if (prev === undefined) return null;
        if (format === 'percent') {
            const diff = (value - prev) * 100;
            const sign = diff > 0 ? '+' : '';
            return { text: `${sign}${diff.toFixed(1)}pp`, up: diff > 0 };
        }
        if (prev === 0) return value > 0 ? { text: 'new', up: true } : null;
        const ratio = (value - prev) / prev;
        const sign = ratio > 0 ? '+' : '';
        return { text: `${sign}${(ratio * 100).toFixed(0)}%`, up: ratio > 0 };
    });

    // Delta direction interpretation: for failure rate, "up" is bad.
    const deltaIsBad = $derived(format === 'percent');
    const deltaClass = $derived.by(() => {
        if (!delta) return 'text-surface-600-400';
        const good = deltaIsBad ? !delta.up : delta.up;
        return good ? 'text-success-500' : 'text-error-500';
    });
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="text-surface-600-400 text-xs tracking-wide uppercase">{label}</div>
    <div class="mt-1 flex items-baseline gap-2">
        <span class="text-2xl font-semibold">{display}</span>
        {#if delta}
            <span class={`text-xs font-medium ${deltaClass}`}>{delta.text}</span>
        {/if}
    </div>
</div>
