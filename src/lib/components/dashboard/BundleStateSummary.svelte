<script lang="ts">
    type Row = { app_id: string; state: string; count: number };
    let { data }: { data: Row[] } = $props();

    const pivoted = $derived.by(() => {
        const byApp = new Map<string, { active: number; pending: number; failed: number }>();
        for (const r of data) {
            let row = byApp.get(r.app_id);
            if (!row) byApp.set(r.app_id, (row = { active: 0, pending: 0, failed: 0 }));
            if (r.state === 'active') row.active = r.count;
            else if (r.state === 'pending') row.pending = r.count;
            else if (r.state === 'failed') row.failed = r.count;
        }
        return Array.from(byApp.entries()).map(([app, counts]) => ({ app, ...counts }));
    });
</script>

<div class="card preset-filled-surface-100-900 p-4">
    <h3 class="h5 mb-3">Bundle pipeline</h3>
    {#if pivoted.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No bundles yet.</p>
    {:else}
        <div class="table-wrap">
            <table class="table text-sm">
                <thead>
                    <tr>
                        <th>App</th>
                        <th class="text-right">Active</th>
                        <th class="text-right">Pending</th>
                        <th class="text-right">Failed</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {#each pivoted as row}
                        <tr>
                            <td><code class="text-xs">{row.app}</code></td>
                            <td class="text-right tabular-nums">{row.active}</td>
                            <td class="text-right tabular-nums">
                                {#if row.pending > 0}
                                    <span class="badge preset-tonal-warning">{row.pending}</span>
                                {:else}
                                    0
                                {/if}
                            </td>
                            <td class="text-right tabular-nums">
                                {#if row.failed > 0}
                                    <span class="badge preset-tonal-error">{row.failed}</span>
                                {:else}
                                    0
                                {/if}
                            </td>
                            <td class="space-x-3 text-right whitespace-nowrap">
                                <a class="anchor text-xs" href="/dashboard/apps/{row.app}">Bundles</a>
                                <a class="anchor text-xs" href="/dashboard/apps/{row.app}/stats">Stats</a>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
