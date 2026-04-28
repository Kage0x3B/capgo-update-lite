<script lang="ts">
    import { actionLabel } from '$lib/util/statsActions.js';

    type Stage = { action: string; devices: number };
    type FunnelData = {
        target: { version: string } | null;
        activeDevices: number;
        stages: Stage[];
    };
    let { data }: { data: FunnelData } = $props();

    const maxDevices = $derived(Math.max(1, data.activeDevices, ...data.stages.map((s) => s.devices)));
    const firstStage = $derived(data.stages[0]?.devices ?? 0);
    // Estimate of installed devices that haven't started this rollout yet.
    // Floored at zero — `activeDevices` is a 7d rolling count and the
    // window-scoped funnel can technically exceed it.
    const notStarted = $derived(Math.max(0, data.activeDevices - firstStage));

    function pct(stage: Stage): string {
        if (firstStage === 0) return '';
        return `${((stage.devices / firstStage) * 100).toFixed(0)}%`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5 shrink-0">Rollout funnel</h3>
        {#if data.target}
            <span class="text-surface-600-400 min-w-0 truncate text-xs" title={data.target.version}>
                Currently-active bundle
                <code class="text-surface-950-50 font-mono">{data.target.version}</code>
            </span>
        {:else}
            <span class="text-surface-600-400 text-xs">No active bundle</span>
        {/if}
    </div>

    {#if !data.target}
        <p class="text-surface-600-400 py-4 text-sm">No active bundle to track.</p>
    {:else}
        <dl class="border-surface-200-800 mb-3 grid grid-cols-2 gap-3 border-b pb-3 text-sm">
            <div>
                <dt class="text-surface-600-400 text-xs tracking-wide uppercase">Active devices (7d)</dt>
                <dd class="text-lg font-semibold tabular-nums">{data.activeDevices}</dd>
            </div>
            <div>
                <dt class="text-surface-600-400 text-xs tracking-wide uppercase">Not started yet (est.)</dt>
                <dd class="text-lg font-semibold tabular-nums">{notStarted}</dd>
            </div>
        </dl>

        {#if data.stages.every((s) => s.devices === 0)}
            <p class="text-surface-600-400 py-4 text-sm">No events for this bundle yet.</p>
        {:else}
            <div class="space-y-2 text-sm">
                {#each data.stages as stage}
                    {@const w = (stage.devices / maxDevices) * 100}
                    <div class="flex items-center gap-3">
                        <span class="text-surface-600-400 w-32 shrink-0 truncate text-xs sm:w-40" title={stage.action}>
                            {actionLabel(stage.action)}
                        </span>
                        <div class="bg-surface-200-800 relative h-6 min-w-0 flex-1 overflow-hidden rounded">
                            <div class="bg-primary-500 h-full" style:width="{w}%"></div>
                            <span class="absolute top-1/2 left-2 -translate-y-1/2 text-xs font-medium">
                                {stage.devices}
                            </span>
                        </div>
                        <span class="text-surface-600-400 w-10 shrink-0 text-right text-xs">
                            {pct(stage)}
                        </span>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>
