<script lang="ts">
    type Row = { plugin_version: string; devices: number };
    let { data }: { data: Row[] } = $props();

    const maxDevices = $derived(Math.max(1, ...data.map((r) => r.devices)));
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <h3 class="h5 mb-3">Plugin versions</h3>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-6 text-center text-sm">No plugin data yet.</p>
    {:else}
        <div class="space-y-1.5 text-sm">
            {#each data as row}
                {@const w = (row.devices / maxDevices) * 100}
                <div class="flex items-center gap-3">
                    <code class="w-24 shrink-0 text-xs">{row.plugin_version}</code>
                    <div class="bg-surface-200-800 relative h-5 flex-1 overflow-hidden rounded">
                        <div class="bg-secondary-500 h-full" style:width="{w}%"></div>
                    </div>
                    <span class="text-surface-600-400 w-10 shrink-0 text-right text-xs">
                        {row.devices}
                    </span>
                </div>
            {/each}
        </div>
    {/if}
</div>
