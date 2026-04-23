<script lang="ts">
    import AutoRollbacksList from '$lib/components/dashboard/AutoRollbacksList.svelte';
    import BundleStateSummary from '$lib/components/dashboard/BundleStateSummary.svelte';
    import PlatformDonut from '$lib/components/dashboard/PlatformDonut.svelte';
    import RecentActivity from '$lib/components/dashboard/RecentActivity.svelte';
    import TimeWindow from '$lib/components/dashboard/TimeWindow.svelte';
    import UpdateCheckSparkline from '$lib/components/dashboard/UpdateCheckSparkline.svelte';
    import type { DashboardWindow } from '$lib/server/validation/analytics.js';
    import { getDashboard } from './overview.remote';

    let win = $state<DashboardWindow>('7d');
    const data = $derived(await getDashboard({ window: win }));
</script>

<svelte:head>
    <title>Overview — capgo-update-lite</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-baseline justify-between gap-3">
    <div>
        <h1 class="h2">Overview</h1>
        <p class="text-surface-600-400 mt-1 text-sm">
            Cross-app health. Version-specific panels live on each app's stats page.
        </p>
    </div>
    <TimeWindow bind:value={win} />
</header>

<section class="mb-6">
    <BundleStateSummary data={data.bundles} />
</section>

<section class="mb-6 grid gap-4 lg:grid-cols-2">
    <PlatformDonut data={data.platform} />
    <AutoRollbacksList data={data.rollbacks} />
</section>

<section class="mb-6">
    <UpdateCheckSparkline data={data.checks} />
</section>

<section class="mb-6">
    <RecentActivity data={data.recent} />
</section>
