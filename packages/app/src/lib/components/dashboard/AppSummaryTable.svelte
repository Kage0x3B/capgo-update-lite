<script lang="ts">
    type Row = {
        appId: string;
        activeDevices: number;
        updateChecks: number;
        devicesUpdated: number;
        failedDevices: number;
        upToDate: number | null;
        lastSeen: string | null;
    };
    let { rows }: { rows: Row[] } = $props();

    function ago(iso: string | null): string {
        if (!iso) return '—';
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
        if (m < 60) return `${Math.max(0, m)}m ago`;
        const h = Math.round(m / 60);
        if (h < 48) return `${h}h ago`;
        return `${Math.round(h / 24)}d ago`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <h3 class="h5 mb-3">Apps</h3>
    {#if rows.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No app sent anything in this window.</p>
    {:else}
        <div class="table-wrap">
            <table class="table text-sm">
                <thead>
                    <tr>
                        <th>App</th>
                        <th class="text-right">Active devices</th>
                        <th class="text-right">Up to date</th>
                        <th class="text-right">Updated</th>
                        <th class="text-right">With failures</th>
                        <th class="text-right">Update checks</th>
                        <th>Last event</th>
                    </tr>
                </thead>
                <tbody>
                    {#each rows as r (r.appId)}
                        <tr>
                            <td><a class="anchor" href="/dashboard/apps/{r.appId}/stats"><code>{r.appId}</code></a></td>
                            <td class="text-right tabular-nums">{r.activeDevices.toLocaleString()}</td>
                            <td class="text-right tabular-nums">
                                {r.upToDate === null ? '—' : `${(r.upToDate * 100).toFixed(0)}%`}
                            </td>
                            <td class="text-right tabular-nums">{r.devicesUpdated.toLocaleString()}</td>
                            <td class="text-right tabular-nums" class:text-error-500={r.failedDevices > 0}>
                                {r.failedDevices.toLocaleString()}
                            </td>
                            <td class="text-right tabular-nums">{r.updateChecks.toLocaleString()}</td>
                            <td class="text-surface-600-400 text-xs whitespace-nowrap" title={r.lastSeen ?? ''}>
                                {ago(r.lastSeen)}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
