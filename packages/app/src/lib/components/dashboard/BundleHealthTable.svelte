<script lang="ts">
    import type { BundleHealthRow, BundleHealthSeverity } from '$lib/server/services/bundleHealth.js';
    import BundleHealthBadge from './BundleHealthBadge.svelte';

    type Props = { rows: BundleHealthRow[] };
    let { rows }: Props = $props();

    const SEVERITY_RANK: Record<BundleHealthSeverity, number> = {
        auto_disabled: 0,
        at_risk: 1,
        warning: 2,
        noisy: 3,
        manually_disabled: 4,
        healthy: 5
    };
    const sorted = $derived(
        [...rows].sort(
            (a, b) =>
                SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
                b.failRate - a.failRate ||
                a.version.localeCompare(b.version)
        )
    );
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <h3 class="h5 mb-3">Bundle health</h3>
    {#if sorted.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No bundles yet.</p>
    {:else}
        <!-- Mobile: card list -->
        <ul class="divide-surface-200-800 divide-y sm:hidden">
            {#each sorted as r (r.bundleId)}
                <li class="space-y-1 py-2">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <code class="font-mono text-xs break-all">{r.version}</code>
                        <div class="flex shrink-0 items-center gap-2">
                            {#if r.state === 'active'}
                                <span class="badge preset-tonal-success">{r.active ? 'live' : 'active'}</span>
                            {:else if r.state === 'pending'}
                                <span class="badge preset-tonal-warning">pending</span>
                            {:else}
                                <span class="badge preset-tonal-error">{r.state}</span>
                            {/if}
                            <BundleHealthBadge
                                severity={r.severity}
                                attempted={r.attemptedDevices}
                                failed={r.failedDevices}
                                rate={r.failRate}
                            />
                        </div>
                    </div>
                    <div class="text-surface-600-400 flex flex-wrap gap-x-3 text-xs tabular-nums">
                        <span>channel <code>{r.channel}</code></span>
                        <span>{r.attemptedDevices} devices</span>
                        <span>{r.failedDevices} failed</span>
                        <span>{(r.failRate * 100).toFixed(r.failRate >= 0.1 ? 0 : 1)}%</span>
                    </div>
                </li>
            {/each}
        </ul>

        <!-- Desktop: table -->
        <div class="table-wrap hidden sm:block">
            <table class="table text-sm">
                <thead>
                    <tr>
                        <th>Version</th>
                        <th>Channel</th>
                        <th>State</th>
                        <th class="text-right">Devices</th>
                        <th class="text-right">Failed</th>
                        <th class="text-right">Rate</th>
                        <th>Severity</th>
                    </tr>
                </thead>
                <tbody>
                    {#each sorted as r (r.bundleId)}
                        <tr>
                            <td><code class="text-xs">{r.version}</code></td>
                            <td class="text-xs">{r.channel}</td>
                            <td>
                                {#if r.state === 'active'}
                                    <span class="badge preset-tonal-success">{r.active ? 'live' : 'active'}</span>
                                {:else if r.state === 'pending'}
                                    <span class="badge preset-tonal-warning">pending</span>
                                {:else}
                                    <span class="badge preset-tonal-error">{r.state}</span>
                                {/if}
                            </td>
                            <td class="text-right tabular-nums">{r.attemptedDevices}</td>
                            <td class="text-right tabular-nums">{r.failedDevices}</td>
                            <td class="text-right tabular-nums">
                                {(r.failRate * 100).toFixed(r.failRate >= 0.1 ? 0 : 1)}%
                            </td>
                            <td>
                                <BundleHealthBadge
                                    severity={r.severity}
                                    attempted={r.attemptedDevices}
                                    failed={r.failedDevices}
                                    rate={r.failRate}
                                />
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <p class="text-surface-600-400 mt-2 text-xs">
            Counts cover the full history of each bundle (since publication or last reactivation), not the selected time
            window.
        </p>
    {/if}
</div>
