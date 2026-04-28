<script lang="ts">
    import { ArrowRight } from '@lucide/svelte';
    import { actionLabel } from '$lib/util/statsActions.js';

    type Row = {
        id: string;
        receivedAt: string;
        appId: string;
        deviceId: string;
        action: string | null;
        versionName: string | null;
        platform: string | null;
    };
    let { data }: { data: Row[] } = $props();

    function fmt(iso: string): string {
        return iso.slice(11, 19); // HH:MM:SS
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex items-baseline justify-between">
        <h3 class="h5">Recent activity</h3>
        <a class="anchor inline-flex items-center gap-1 text-xs" href="/dashboard/stats">
            All events <ArrowRight class="size-3" />
        </a>
    </div>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No events.</p>
    {:else}
        <ul class="divide-surface-200-800 divide-y text-sm">
            {#each data as ev}
                <li class="py-1.5">
                    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span class="text-surface-600-400 shrink-0 font-mono text-xs">
                            {fmt(ev.receivedAt)}
                        </span>
                        <span class="min-w-0 flex-1 text-xs" title={ev.action ?? ''}>
                            {actionLabel(ev.action)}
                        </span>
                        {#if ev.versionName}
                            <span class="shrink-0 font-mono text-xs whitespace-nowrap" title={ev.versionName}>
                                {ev.versionName}
                            </span>
                        {/if}
                    </div>
                    <div class="text-surface-600-400 mt-0.5 flex gap-2 text-[11px]">
                        {#if ev.platform}<span class="shrink-0">{ev.platform}</span>{/if}
                        <span class="min-w-0 truncate font-mono" title={ev.appId}>{ev.appId}</span>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>
