<script lang="ts">
    type Row = { from_v: string; to_v: string; devices: number; last_seen: string };
    let { data }: { data: Row[] } = $props();

    function fmt(iso: string): string {
        return iso.slice(0, 19).replace('T', ' ');
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <h3 class="h5 mb-3">Auto-rollback incidents</h3>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No rollbacks detected in window.</p>
    {:else}
        <div class="table-wrap">
            <table class="table text-sm">
                <thead>
                    <tr>
                        <th>From</th>
                        <th>To</th>
                        <th class="text-right">Devices</th>
                        <th>Last seen</th>
                    </tr>
                </thead>
                <tbody>
                    {#each data as row}
                        <tr>
                            <td><code class="text-xs">{row.from_v}</code></td>
                            <td><code class="text-xs">{row.to_v}</code></td>
                            <td class="text-right tabular-nums">{row.devices}</td>
                            <td class="text-surface-600-400 text-xs">{fmt(row.last_seen)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
