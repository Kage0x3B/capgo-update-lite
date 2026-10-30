<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { CATEGORY_COLORS, resultInfo, resultLabel } from '$lib/util/updateResults.js';
    import { getDevices } from './devices.remote';

    const appId = $derived(page.params.id ?? '');
    const search = $derived(page.url.searchParams.get('q') ?? '');
    const result = $derived(page.url.searchParams.get('result') ?? '');
    const rows = $derived(await getDevices({ app_id: appId, search, result }));

    let draft = $state('');
    $effect(() => {
        draft = search;
    });

    function apply(e: SubmitEvent) {
        e.preventDefault();
        const params = new URLSearchParams();
        if (draft.trim()) params.set('q', draft.trim());
        if (result) params.set('result', result);
        const qs = params.toString();
        goto(`/dashboard/apps/${appId}/devices${qs ? `?${qs}` : ''}`, { keepFocus: true });
    }

    function ago(iso: string): string {
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
        if (m < 60) return `${Math.max(0, m)}m ago`;
        const h = Math.round(m / 60);
        if (h < 48) return `${h}h ago`;
        return `${Math.round(h / 24)}d ago`;
    }
</script>

<svelte:head>
    <title>{appId} — Devices</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
    <p class="text-surface-600-400 text-sm">
        Devices that checked for updates in the last 7 days, newest first, with the server's latest answer.
    </p>
    <form class="flex gap-2" onsubmit={apply}>
        <input
            class="input w-64 py-1 text-sm"
            bind:value={draft}
            placeholder="Device id prefix or custom id"
            aria-label="Search devices"
        />
        <button class="btn btn-sm preset-filled-primary-500" type="submit">Search</button>
    </form>
</div>

{#if result}
    <p class="mb-3 text-sm">
        Showing devices whose latest answer was <strong>{resultLabel(result)}</strong>.
        <a class="anchor" href="/dashboard/apps/{appId}/devices{search ? `?q=${encodeURIComponent(search)}` : ''}"
            >Show all</a
        >
    </p>
{/if}

{#if rows.length === 0}
    <p class="text-surface-600-400">
        No matching devices. Update checks are logged from this server version on, so the list fills as devices open the
        app.
    </p>
{:else}
    <div class="table-wrap">
        <table class="table text-sm">
            <thead>
                <tr>
                    <th>Device</th>
                    <th>Last check</th>
                    <th>Answer</th>
                    <th>Bundle</th>
                    <th>Native</th>
                    <th>Channel</th>
                    <th>Plugin</th>
                    <th class="text-right">Checks (7d)</th>
                </tr>
            </thead>
            <tbody>
                {#each rows as d (d.deviceId)}
                    {@const info = resultInfo(d.lastResult)}
                    <tr>
                        <td>
                            <a class="anchor font-mono text-xs" href="/dashboard/apps/{appId}/devices/{d.deviceId}"
                                >{d.deviceId.slice(0, 8)}…</a
                            >
                            {#if d.customId}<span class="text-surface-600-400 block text-xs">{d.customId}</span>{/if}
                        </td>
                        <td class="text-surface-600-400 text-xs whitespace-nowrap" title={d.lastSeen}
                            >{ago(d.lastSeen)}</td
                        >
                        <td class="text-xs">
                            <span class="inline-flex items-center gap-1.5">
                                <span
                                    class="inline-block h-2 w-2 rounded-sm"
                                    style:background={CATEGORY_COLORS[info.category]}
                                ></span>
                                {info.label}
                            </span>
                        </td>
                        <td><code class="text-xs">{d.versionName ?? '—'}</code></td>
                        <td class="text-xs">
                            {d.platform ?? ''} <code>{d.versionBuild ?? '—'}</code>
                        </td>
                        <td><code class="text-xs">{d.channel ?? '—'}</code></td>
                        <td><code class="text-xs">{d.pluginVersion ?? '—'}</code></td>
                        <td class="text-right tabular-nums">{d.checks}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
{/if}
