<script lang="ts">
    import KpiCard from './KpiCard.svelte';

    type Kpis = {
        activeDevices: number;
        activeDevicesPrev: number;
        updateChecks: number;
        updateChecksPrev: number;
        devicesUpdated: number;
        devicesUpdatedPrev: number;
        failureRate: number;
        failureRatePrev: number;
        upToDate: number | null;
        latestBundles: { channel: string; version: string; releasedAt: string | null }[];
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

<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
    <div class="card preset-filled-surface-100-900 col-span-2 min-w-0 p-3 sm:p-4 md:col-span-1">
        <div class="text-surface-600-400 text-xs tracking-wide uppercase">
            Latest bundle{data.latestBundles.length > 1 ? 's' : ''}
        </div>
        {#if data.latestBundles.length === 0}
            <div class="mt-1 flex items-baseline gap-2">
                <span class="text-surface-600-400 text-xl font-semibold">—</span>
                <span class="text-surface-600-400 shrink-0 text-xs">no active bundle</span>
            </div>
        {:else}
            <ul class="mt-1 space-y-0.5">
                {#each data.latestBundles as b (b.channel)}
                    <li class="min-w-0">
                        <code class="block truncate font-semibold" title={b.version}>{b.version}</code>
                        <span class="text-surface-600-400 block truncate text-xs" title={b.releasedAt ?? ''}>
                            {b.channel}{b.releasedAt ? ` · ${relTime(b.releasedAt)}` : ''}
                        </span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
    <KpiCard
        label="Active devices"
        value={data.activeDevices}
        prev={data.activeDevicesPrev}
        hint="Distinct devices that sent any event in the window"
    />
    <KpiCard
        label="Up to date"
        value={data.upToDate}
        format="percent"
        hint="Devices whose latest update check said there was nothing newer for them"
    />
    <KpiCard
        label="Devices updated"
        value={data.devicesUpdated}
        prev={data.devicesUpdatedPrev}
        hint="Distinct devices that installed a bundle in the window"
    />
    <KpiCard
        label="Failure rate"
        value={data.failureRate}
        prev={data.failureRatePrev}
        format="percent"
        goodWhen="down"
        hint="Devices that reported a failure ÷ devices that tried to download or install a bundle"
    />
    <KpiCard
        label="Update checks"
        value={data.updateChecks}
        prev={data.updateChecksPrev}
        hint="Calls to /updates in the window"
    />
</div>
