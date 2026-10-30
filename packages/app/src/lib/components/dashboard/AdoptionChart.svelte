<script lang="ts">
    import StackedBars, { type Series } from './StackedBars.svelte';

    type Adoption = {
        buckets: string[];
        versions: string[];
        points: { t: string; version: string; devices: number }[];
    };
    let { data }: { data: Adoption } = $props();

    // Newest version gets the strongest colour; "other" is neutral grey.
    const PALETTE = [
        'var(--color-primary-500)',
        'var(--color-success-500)',
        'var(--color-secondary-500)',
        'var(--color-tertiary-500)',
        'var(--color-warning-500)',
        'var(--color-error-400)',
        'var(--color-primary-300)'
    ];

    const lookup = $derived(new Map(data.points.map((p) => [`${p.t}|${p.version}`, p.devices])));

    // Stack oldest at the bottom so the newest version grows on top.
    const series = $derived<Series[]>(
        data.versions
            .map((v, i) => ({
                key: v,
                label: v === 'other' ? 'older / other' : v,
                color: v === 'other' ? 'var(--color-surface-400-600)' : PALETTE[i % PALETTE.length]
            }))
            .toReversed()
    );
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">Devices by bundle version</h3>
        <span class="text-surface-600-400 text-xs"
            >Each active device counted once, at the last version it reported</span
        >
    </div>
    <StackedBars buckets={data.buckets} {series} value={(t, v) => lookup.get(`${t}|${v}`) ?? 0} />
</div>
