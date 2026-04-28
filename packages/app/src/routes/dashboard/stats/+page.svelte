<script lang="ts">
    import { ACTION_GROUPS, actionLabel } from '$lib/util/statsActions.js';
    import { getStatsEvents } from './stats.remote';

    let appId = $state('');
    let action = $state('');
    let limit = $state(200);

    let filters = $state({ app_id: '', action: '', limit: 200 });
    const rows = $derived(await getStatsEvents(filters));

    function applyFilters(e: SubmitEvent) {
        e.preventDefault();
        filters = {
            app_id: appId.trim(),
            action: action.trim(),
            limit
        };
    }

    function fmtTime(d: Date): string {
        return d.toISOString().slice(0, 19).replace('T', ' ');
    }
</script>

<svelte:head>
    <title>Stats — capgo-update-lite</title>
</svelte:head>

<header class="mb-6">
    <h1 class="h3 sm:h2">Stats events</h1>
    <p class="text-surface-600-400 text-sm">
        Read-only tail of the <code>stats_events</code> table. Newest first. Max 1000 rows.
    </p>
</header>

<form
    class="card preset-filled-surface-100-900 mb-6 flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4"
    onsubmit={applyFilters}
>
    <label class="label flex-1">
        <span class="label-text">App id</span>
        <input class="input" bind:value={appId} placeholder="com.example.app" />
    </label>
    <label class="label flex-1">
        <span class="label-text">Action</span>
        <select class="select" bind:value={action}>
            <option value="">Any action</option>
            {#each ACTION_GROUPS as group}
                <optgroup label={group.label}>
                    {#each group.actions as code}
                        <option value={code}>{actionLabel(code)}</option>
                    {/each}
                </optgroup>
            {/each}
        </select>
    </label>
    <label class="label sm:w-28">
        <span class="label-text">Limit</span>
        <input class="input" type="number" min="1" max="1000" bind:value={limit} />
    </label>
    <button class="btn preset-filled-primary-500" type="submit">Apply</button>
</form>

{#if rows.length === 0}
    <p class="text-surface-600-400">No events match.</p>
{:else}
    <!-- Mobile: card list -->
    <ul class="card preset-filled-surface-100-900 divide-surface-200-800 divide-y px-3 md:hidden">
        {#each rows as ev}
            <li class="space-y-1 py-2">
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span class="text-surface-600-400 font-mono text-xs">{fmtTime(ev.receivedAt)}</span>
                    <span class="text-sm" title={ev.action ?? ''}>{actionLabel(ev.action)}</span>
                </div>
                <div class="text-surface-600-400 flex flex-wrap gap-x-3 text-xs">
                    <code class="break-all">{ev.appId}</code>
                    {#if ev.versionName}<span>v{ev.versionName}</span>{/if}
                    {#if ev.platform}<span>{ev.platform}</span>{/if}
                    <span class="font-mono">{ev.deviceId.slice(0, 8)}…</span>
                </div>
            </li>
        {/each}
    </ul>

    <!-- Desktop: table -->
    <div class="table-wrap hidden md:block">
        <table class="table">
            <thead>
                <tr>
                    <th>Received</th>
                    <th>App</th>
                    <th>Action</th>
                    <th>Device</th>
                    <th>Version</th>
                    <th>Platform</th>
                </tr>
            </thead>
            <tbody>
                {#each rows as ev}
                    <tr>
                        <td class="text-surface-600-400 font-mono text-xs whitespace-nowrap">
                            {fmtTime(ev.receivedAt)}
                        </td>
                        <td><code class="text-xs">{ev.appId}</code></td>
                        <td>
                            <span title={ev.action ?? ''}>{actionLabel(ev.action)}</span>
                        </td>
                        <td class="text-surface-600-400 font-mono text-xs">{ev.deviceId.slice(0, 8)}…</td>
                        <td>{ev.versionName ?? '—'}</td>
                        <td>{ev.platform ?? '—'}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
{/if}
