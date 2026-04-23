<script lang="ts">
    import { page } from '$app/state';
    import AdoptionChart from '$lib/components/dashboard/AdoptionChart.svelte';
    import AutoRollbacksList from '$lib/components/dashboard/AutoRollbacksList.svelte';
    import FailureBreakdown from '$lib/components/dashboard/FailureBreakdown.svelte';
    import KpiStrip from '$lib/components/dashboard/KpiStrip.svelte';
    import PlatformDonut from '$lib/components/dashboard/PlatformDonut.svelte';
    import PluginVersionBars from '$lib/components/dashboard/PluginVersionBars.svelte';
    import RecentActivity from '$lib/components/dashboard/RecentActivity.svelte';
    import RolloutFunnel from '$lib/components/dashboard/RolloutFunnel.svelte';
    import TimeWindow from '$lib/components/dashboard/TimeWindow.svelte';
    import UpdateCheckSparkline from '$lib/components/dashboard/UpdateCheckSparkline.svelte';
    import type { DashboardWindow } from '$lib/server/validation/analytics.js';
    import { getAppDashboard } from './stats.remote';

    const appId = $derived(page.params.id ?? '');
    let win = $state<DashboardWindow>('7d');
    const data = $derived(await getAppDashboard({ window: win, app_id: appId }));
</script>

<svelte:head>
    <title>{appId} — Stats</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div class="flex-1">
        <p class="text-surface-600-400 text-xs">
            <a class="anchor" href="/dashboard/apps">← All apps</a>
        </p>
        <h1 class="h2"><code>{appId}</code></h1>
        <nav class="border-surface-200-800 mt-4 flex gap-5 border-b text-sm">
            <a
                href="/dashboard/apps/{appId}"
                class="text-surface-600-400 hover:text-surface-950-50 -mb-px border-b-2 border-transparent px-1 pb-2"
            >
                Bundles
            </a>
            <span
                class="border-primary-500 text-primary-500 -mb-px border-b-2 px-1 pb-2 font-semibold"
            >
                Stats
            </span>
        </nav>
    </div>
    <TimeWindow bind:value={win} />
</header>

<section class="mb-6">
    <KpiStrip data={data.kpis} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-3">
    <div class="lg:col-span-2">
        <AdoptionChart data={data.adoption} />
    </div>
    <FailureBreakdown data={data.failures} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-2">
    <PlatformDonut data={data.platform} />
    <PluginVersionBars data={data.plugins} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-2">
    <RolloutFunnel data={data.funnel} />
    <AutoRollbacksList data={data.rollbacks} />
</section>

<section class="mb-6">
    <UpdateCheckSparkline data={data.checks} />
</section>

<section class="mb-6">
    <RecentActivity data={data.recent} />
</section>
