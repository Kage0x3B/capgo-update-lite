<script lang="ts">
    import { actionLabel } from '$lib/util/statsActions.js';

    type Row = {
        version: string;
        count: number;
        devices: number;
        actions: { action: string; count: number; devices: number }[];
    };
    let { data }: { data: Row[] } = $props();

    const maxDevices = $derived(Math.max(1, ...data.map((r) => r.devices)));
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">Failures by version</h3>
        <span class="text-surface-600-400 text-xs">Devices (events)</span>
    </div>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-6 text-center text-sm">No failures recorded.</p>
    {:else}
        <ul class="divide-surface-200-800 divide-y text-sm">
            {#each data as row}
                {@const w = (row.devices / maxDevices) * 100}
                <li class="py-2">
                    <div class="mb-1 flex items-baseline justify-between gap-2">
                        <code class="min-w-0 truncate font-mono text-xs" title={row.version}>{row.version}</code>
                        <span class="text-surface-600-400 shrink-0 text-xs tabular-nums"
                            >{row.devices} <span class="text-[10px]">({row.count})</span></span
                        >
                    </div>
                    <div class="bg-surface-200-800 relative h-5 overflow-hidden rounded">
                        <div class="bg-error-500 h-full" style:width="{w}%"></div>
                    </div>
                    {#if row.actions.length > 0}
                        <div class="mt-1.5 flex flex-wrap gap-1.5">
                            {#each row.actions as a}
                                <span
                                    class="bg-surface-200-800 text-surface-700-300 inline-flex max-w-full items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap"
                                    title="{actionLabel(a.action)}: {a.devices} devices, {a.count} {a.count === 1
                                        ? 'event'
                                        : 'events'}"
                                >
                                    <span class="truncate">{actionLabel(a.action)}</span>
                                    <span class="text-surface-600-400 shrink-0 tabular-nums">{a.devices}</span>
                                </span>
                            {/each}
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>
