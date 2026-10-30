<script lang="ts">
    import { page } from '$app/state';
    import AdoptionChart from '$lib/components/dashboard/AdoptionChart.svelte';
    import AutoRollbacksList from '$lib/components/dashboard/AutoRollbacksList.svelte';
    import BarList from '$lib/components/dashboard/BarList.svelte';
    import BundleHealthTable from '$lib/components/dashboard/BundleHealthTable.svelte';
    import FailureBreakdown from '$lib/components/dashboard/FailureBreakdown.svelte';
    import KpiStrip from '$lib/components/dashboard/KpiStrip.svelte';
    import PlatformDonut from '$lib/components/dashboard/PlatformDonut.svelte';
    import RecentActivity from '$lib/components/dashboard/RecentActivity.svelte';
    import RolloutFunnel from '$lib/components/dashboard/RolloutFunnel.svelte';
    import TimeWindow from '$lib/components/dashboard/TimeWindow.svelte';
    import UpdateOutcomeTable from '$lib/components/dashboard/UpdateOutcomeTable.svelte';
    import UpdateOutcomesChart from '$lib/components/dashboard/UpdateOutcomesChart.svelte';
    import type { DashboardWindow } from '$lib/server/validation/analytics.js';
    import { getBundleHealth } from '../bundles.remote';
    import { getAppDashboard } from './stats.remote';

    const appId = $derived(page.params.id ?? '');
    let win = $state<DashboardWindow>('7d');
    const data = $derived(await getAppDashboard({ window: win, app_id: appId }));
    const health = $derived(await getBundleHealth({ app_id: appId }));

    // Only bundles devices actually tried (or that were pulled) are worth a
    // row here; the Bundles tab lists everything.
    const healthRows = $derived(health.filter((h) => h.attemptedDevices > 0 || h.state === 'failed'));
</script>

<svelte:head>
    <title>{appId} — Stats</title>
</svelte:head>

<div class="mb-6 flex justify-end">
    <TimeWindow bind:value={win} />
</div>

<section class="mb-6">
    <KpiStrip data={data.kpis} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-2">
    <AdoptionChart data={data.adoption} />
    <UpdateOutcomesChart data={data.outcomes} />
</section>

<section class="mb-6">
    <UpdateOutcomeTable rows={data.outcomeTable} {appId} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-3">
    <div class="lg:col-span-2">
        <RolloutFunnel data={data.funnels} />
    </div>
    <FailureBreakdown data={data.failures} />
</section>

<section class="mb-6">
    <BundleHealthTable rows={healthRows} />
</section>

<section class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <PlatformDonut data={data.platform} />
    <BarList
        title="Native app versions"
        note="From update checks"
        empty="No update checks yet."
        color="var(--color-tertiary-500)"
        rows={data.native.map((r) => ({ label: r.version, devices: r.devices, group: r.platform }))}
    />
    <BarList
        title="Plugin versions"
        rows={data.plugins.map((r) => ({ label: r.plugin_version, devices: r.devices }))}
    />
    <BarList
        title="Channels"
        note="From update checks"
        empty="No update checks yet."
        color="var(--color-primary-500)"
        rows={data.channels.map((r) => ({ label: r.value, devices: r.devices }))}
    />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-2">
    <AutoRollbacksList data={data.rollbacks} />
    <RecentActivity data={data.recent} />
</section>
