<script lang="ts">
    import { actionLabel } from '$lib/util/statsActions.js';

    type Stage = { action: string; devices: number };
    type Funnel = {
        channel: string;
        target: { version: string };
        activeDevices: number;
        stages: Stage[];
    };
    let { data }: { data: Funnel[] } = $props();

    function pct(stage: Stage, first: number): string {
        if (first === 0) return '';
        return `${((stage.devices / first) * 100).toFixed(0)}%`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5 shrink-0">Rollout funnel</h3>
        <span class="text-surface-600-400 text-xs">Newest live bundle per channel</span>
    </div>

    {#if data.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No active bundle to track.</p>
    {:else}
        <div class="space-y-5">
            {#each data as funnel (funnel.channel)}
                {@const first = funnel.stages[0]?.devices ?? 0}
                {@const maxDevices = Math.max(1, funnel.activeDevices, ...funnel.stages.map((s) => s.devices))}
                {@const notStarted = Math.max(0, funnel.activeDevices - first)}
                <div>
                    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span>
                            <code class="font-semibold">{funnel.target.version}</code>
                            <span class="text-surface-600-400 text-xs">on {funnel.channel}</span>
                        </span>
                        <span class="text-surface-600-400 text-xs tabular-nums">
                            {funnel.activeDevices} active devices (7d) · {notStarted} not started
                        </span>
                    </div>
                    {#if funnel.stages.every((s) => s.devices === 0)}
                        <p class="text-surface-600-400 text-sm">No events for this bundle in the window.</p>
                    {:else}
                        <div class="space-y-1.5 text-sm">
                            {#each funnel.stages as stage}
                                {@const w = (stage.devices / maxDevices) * 100}
                                <div class="flex items-center gap-3">
                                    <span
                                        class="text-surface-600-400 w-32 shrink-0 truncate text-xs sm:w-40"
                                        title={stage.action}
                                    >
                                        {actionLabel(stage.action)}
                                    </span>
                                    <div class="bg-surface-200-800 relative h-5 min-w-0 flex-1 overflow-hidden rounded">
                                        <div class="bg-primary-500 h-full" style:width="{w}%"></div>
                                        <span class="absolute top-1/2 left-2 -translate-y-1/2 text-xs font-medium">
                                            {stage.devices}
                                        </span>
                                    </div>
                                    <span class="text-surface-600-400 w-10 shrink-0 text-right text-xs">
                                        {pct(stage, first)}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>
