<script lang="ts">
    import { CATEGORY_COLORS, resultInfo } from '$lib/util/updateResults.js';

    type Row = {
        result: string;
        channel: string | null;
        checks: number;
        devices: number;
        lastSeen: string;
        sampleDetail: string | null;
        nativeVersions: string[];
    };
    let { rows, appId }: { rows: Row[]; appId: string } = $props();

    const totalDevices = $derived(rows.reduce((s, r) => s + r.devices, 0));

    function ago(iso: string): string {
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
        if (m < 60) return `${Math.max(0, m)}m ago`;
        const h = Math.round(m / 60);
        if (h < 48) return `${h}h ago`;
        return `${Math.round(h / 24)}d ago`;
    }
</script>

<div class="card preset-filled-surface-100-900 p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 class="h5">What devices were told</h3>
        <span class="text-surface-600-400 text-xs">Devices counted once, under their latest check in the window</span>
    </div>
    {#if rows.length === 0}
        <p class="text-surface-600-400 py-4 text-sm">No update checks recorded in this window.</p>
    {:else}
        <div class="table-wrap">
            <table class="table text-sm">
                <thead>
                    <tr>
                        <th>Answer</th>
                        <th>Channel</th>
                        <th class="text-right">Devices</th>
                        <th class="text-right">Checks</th>
                        <th>Native versions</th>
                        <th>Last</th>
                    </tr>
                </thead>
                <tbody>
                    {#each rows as r (`${r.result}|${r.channel}`)}
                        {@const info = resultInfo(r.result)}
                        <tr>
                            <td class="min-w-48">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                                        style:background={CATEGORY_COLORS[info.category]}
                                    ></span>
                                    <a
                                        class="anchor"
                                        href="/dashboard/apps/{appId}/devices?result={encodeURIComponent(r.result)}"
                                        title="Show these devices">{info.label}</a
                                    >
                                </div>
                                {#if info.hint || r.sampleDetail}
                                    <p class="text-surface-600-400 mt-0.5 text-xs">
                                        {info.hint ?? ''}
                                        {#if r.sampleDetail && info.category !== 'served' && info.category !== 'current'}
                                            <span class="block font-mono break-all">{r.sampleDetail}</span>
                                        {/if}
                                    </p>
                                {/if}
                            </td>
                            <td><code class="text-xs">{r.channel ?? '—'}</code></td>
                            <td class="text-right tabular-nums">
                                {r.devices.toLocaleString()}
                                {#if totalDevices > 0}
                                    <span class="text-surface-600-400 text-xs">
                                        ({((r.devices / totalDevices) * 100).toFixed(0)}%)
                                    </span>
                                {/if}
                            </td>
                            <td class="text-right tabular-nums">{r.checks.toLocaleString()}</td>
                            <td class="text-xs">
                                {#each r.nativeVersions as v, i}<code>{v}</code>{i < r.nativeVersions.length - 1
                                        ? ', '
                                        : ''}{/each}
                            </td>
                            <td class="text-surface-600-400 text-xs whitespace-nowrap" title={r.lastSeen}>
                                {ago(r.lastSeen)}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
