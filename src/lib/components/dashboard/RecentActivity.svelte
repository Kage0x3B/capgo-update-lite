<script lang="ts">
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

<div class="card preset-filled-surface-100-900 p-4">
    <div class="mb-3 flex items-baseline justify-between">
        <h3 class="h5">Recent activity</h3>
        <a class="anchor text-xs" href="/dashboard/stats">All events →</a>
    </div>
    {#if data.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No events.</p>
    {:else}
        <ul class="divide-surface-200-800 divide-y text-sm">
            {#each data as ev}
                <li class="flex items-center gap-3 py-1.5">
                    <span class="text-surface-600-400 w-16 shrink-0 font-mono text-xs">
                        {fmt(ev.receivedAt)}
                    </span>
                    <span class="text-xs" title={ev.action ?? ''}>{actionLabel(ev.action)}</span>
                    <span class="text-surface-600-400 truncate text-xs">{ev.appId}</span>
                    {#if ev.versionName}
                        <span class="ml-auto font-mono text-xs">{ev.versionName}</span>
                    {/if}
                    {#if ev.platform}
                        <span class="text-surface-600-400 w-16 text-right text-xs">{ev.platform}</span>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>
