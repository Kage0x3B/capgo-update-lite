<script lang="ts">
    import { page } from '$app/state';
    import AdoptionChart from '$lib/components/dashboard/AdoptionChart.svelte';
    import AutoRollbacksList from '$lib/components/dashboard/AutoRollbacksList.svelte';
    import BundleHealthTable from '$lib/components/dashboard/BundleHealthTable.svelte';
    import FailureBreakdown from '$lib/components/dashboard/FailureBreakdown.svelte';
    import KpiStrip from '$lib/components/dashboard/KpiStrip.svelte';
    import PlatformDonut from '$lib/components/dashboard/PlatformDonut.svelte';
    import PluginVersionBars from '$lib/components/dashboard/PluginVersionBars.svelte';
    import RecentActivity from '$lib/components/dashboard/RecentActivity.svelte';
    import RolloutFunnel from '$lib/components/dashboard/RolloutFunnel.svelte';
    import TimeWindow from '$lib/components/dashboard/TimeWindow.svelte';
    import UpdateCheckSparkline from '$lib/components/dashboard/UpdateCheckSparkline.svelte';
    import type { DashboardWindow } from '$lib/server/validation/analytics.js';
    import { getBundleHealth } from '../bundles.remote';
    import { getAppDashboard } from './stats.remote';

    const appId = $derived(page.params.id ?? '');
    let win = $state<DashboardWindow>('7d');
    const data = $derived(await getAppDashboard({ window: win, app_id: appId }));
    const health = $derived(await getBundleHealth({ app_id: appId }));
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

<section class="mb-6">
    <BundleHealthTable rows={health} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-3">
    <div class="lg:col-span-2">
        <AdoptionChart data={data.adoption} />
    </div>
    <FailureBreakdown data={data.failures} />
</section>

<section class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <PlatformDonut data={data.platform} />
    <PluginVersionBars data={data.plugins} />
    <div class="sm:col-span-2">
        <RolloutFunnel data={data.funnel} />
    </div>
</section>

<section class="mb-6">
    <AutoRollbacksList data={data.rollbacks} />
</section>

<section class="mb-6">
    <UpdateCheckSparkline data={data.checks} />
</section>

<section class="mb-6">
    <RecentActivity data={data.recent} />
</section>
