<script lang="ts">
    import KpiCard from '$lib/components/dashboard/KpiCard.svelte';
    import { getExplorerSummary } from '$lib/remote/explorer.remote.js';
    import type { ExplorerQuery } from '$lib/util/explorer.js';

    let { q, qs }: { q: ExplorerQuery; qs: string } = $props();

    const s = $derived(await getExplorerSummary({ qs }));
    const cur = $derived(s.current);
    const prev = $derived(s.prior);
    const showEvents = $derived(q.source !== 'checks');
    const showChecks = $derived(q.source !== 'events');
    const rate = (n: number, d: number) => (d > 0 ? n / d : null);
</script>

<div class="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
    {#if showEvents}
        <KpiCard label="Events" value={cur.events} prev={prev.events} hint="Plugin events matching the filters" />
    {/if}
    {#if showChecks}
        <KpiCard
            label="Update checks"
            value={cur.checks}
            prev={prev.checks}
            hint="Calls to /updates matching the filters"
        />
    {/if}
    <KpiCard label="Devices" value={cur.devices} prev={prev.devices} hint="Unique devices across the shown rows" />
    {#if showEvents}
        <KpiCard
            label="Failure events"
            value={cur.failures}
            prev={prev.failures}
            goodWhen="down"
            hint="Events in the Failures group"
        />
        <KpiCard
            label="Failure share"
            value={rate(cur.failures, cur.events)}
            prev={rate(prev.failures, prev.events) ?? undefined}
            format="percent"
            goodWhen="down"
            hint="Failure events / all events shown"
        />
    {/if}
    {#if showChecks}
        <KpiCard label="Updates served" value={cur.served} prev={prev.served} hint="Checks answered with a bundle" />
        {#if !showEvents}
            <KpiCard
                label="Blocked share"
                value={rate(cur.blocked, cur.checks)}
                prev={rate(prev.blocked, prev.checks) ?? undefined}
                format="percent"
                goodWhen="down"
                hint="Checks refused by a guard (native too old, policy, plugin) / all checks"
            />
        {/if}
    {/if}
</div>
