<script lang="ts">
    import KpiCard from './KpiCard.svelte';

    type Kpis = {
        activeDevices: number;
        activeDevicesPrev: number;
        updatesDelivered: number;
        updatesDeliveredPrev: number;
        failureRate: number;
        failureRatePrev: number;
        pendingFailedBundles: number;
        currentBundle: { version: string; releasedAt: string | null } | null;
    };

    let { data }: { data: Kpis } = $props();

    function relTime(iso: string | null): string {
        if (!iso) return '';
        const ms = Date.now() - new Date(iso).getTime();
        if (ms < 0) return 'just now';
        const d = Math.floor(ms / 86_400_000);
        if (d >= 1) return `${d}d ago`;
        const h = Math.floor(ms / 3_600_000);
        if (h >= 1) return `${h}h ago`;
        const m = Math.max(0, Math.floor(ms / 60_000));
        return m > 0 ? `${m}m ago` : 'just now';
    }
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
    <div class="card preset-filled-surface-100-900 col-span-2 min-w-0 p-3 sm:p-4 lg:col-span-1">
        <div class="text-surface-600-400 text-xs tracking-wide uppercase">Current bundle</div>
        {#if data.currentBundle}
            <code class="mt-1 block min-w-0 truncate text-base font-semibold" title={data.currentBundle.version}>
                {data.currentBundle.version}
            </code>
            {#if data.currentBundle.releasedAt}
                <span
                    class="text-surface-600-400 mt-0.5 block text-xs"
                    title={new Date(data.currentBundle.releasedAt).toLocaleString()}
                >
                    {relTime(data.currentBundle.releasedAt)}
                </span>
            {/if}
        {:else}
            <div class="mt-1 flex items-baseline gap-2">
                <span class="text-surface-600-400 text-xl font-semibold">—</span>
                <span class="text-surface-600-400 shrink-0 text-xs">no active bundle</span>
            </div>
        {/if}
    </div>
    <KpiCard label="Active devices" value={data.activeDevices} prev={data.activeDevicesPrev} />
    <KpiCard label="Updates delivered" value={data.updatesDelivered} prev={data.updatesDeliveredPrev} />
    <KpiCard label="Failure rate" value={data.failureRate} prev={data.failureRatePrev} format="percent" />
    <KpiCard label="Pending / failed bundles" value={data.pendingFailedBundles} />
</div>
