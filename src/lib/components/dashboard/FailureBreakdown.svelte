<script lang="ts">
    import { actionLabel } from '$lib/util/statsActions.js';

    type Row = { action: string; count: number };
    let { data }: { data: Row[] } = $props();

    const maxCount = $derived(Math.max(1, ...data.map((r) => r.count)));
</script>

<div class="card preset-filled-surface-100-900 p-4">
    <h3 class="h5 mb-3">Failure breakdown</h3>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-6 text-center text-sm">No failures recorded.</p>
    {:else}
        <div class="space-y-1.5 text-sm">
            {#each data as row}
                {@const w = (row.count / maxCount) * 100}
                <div class="flex items-center gap-3">
                    <span class="w-44 shrink-0 truncate text-xs" title={row.action}>
                        {actionLabel(row.action)}
                    </span>
                    <div class="bg-surface-200-800 relative h-5 flex-1 overflow-hidden rounded">
                        <div class="bg-error-500 h-full" style:width="{w}%"></div>
                    </div>
                    <span class="text-surface-600-400 w-10 shrink-0 text-right text-xs">{row.count}</span>
                </div>
            {/each}
        </div>
    {/if}
</div>
