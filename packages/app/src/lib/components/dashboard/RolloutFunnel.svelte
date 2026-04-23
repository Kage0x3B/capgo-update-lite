<script lang="ts">
    type Stage = { stage: string; devices: number };
    let { data }: { data: Stage[] } = $props();

    const maxDevices = $derived(Math.max(1, ...data.map((s) => s.devices)));

    function pct(stage: Stage, index: number, all: Stage[]): string {
        if (index === 0 || all[0].devices === 0) return '';
        const ratio = stage.devices / all[0].devices;
        return `${(ratio * 100).toFixed(0)}%`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-4">
    <div class="mb-3 flex items-baseline justify-between">
        <h3 class="h5">Rollout funnel</h3>
        <span class="text-surface-600-400 text-xs">Currently-active bundle</span>
    </div>

    {#if data.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No active bundle or no events yet.</p>
    {:else}
        <div class="space-y-2 text-sm">
            {#each data as stage, i}
                {@const w = (stage.devices / maxDevices) * 100}
                <div class="flex items-center gap-3">
                    <span class="text-surface-600-400 w-36 shrink-0 text-xs">{stage.stage}</span>
                    <div class="bg-surface-200-800 relative h-6 flex-1 overflow-hidden rounded">
                        <div class="bg-primary-500 h-full" style:width="{w}%"></div>
                        <span class="absolute top-1/2 left-2 -translate-y-1/2 text-xs font-medium">
                            {stage.devices}
                        </span>
                    </div>
                    <span class="text-surface-600-400 w-10 shrink-0 text-right text-xs">
                        {pct(stage, i, data)}
                    </span>
                </div>
            {/each}
        </div>
    {/if}
</div>
