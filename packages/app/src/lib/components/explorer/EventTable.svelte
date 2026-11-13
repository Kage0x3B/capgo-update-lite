<script module lang="ts">
    export type ColumnKey =
        | 'time'
        | 'app'
        | 'event'
        | 'device'
        | 'version'
        | 'native'
        | 'os'
        | 'platform'
        | 'channel'
        | 'plugin'
        | 'country'
        | 'flags'
        | 'detail';

    export const COLUMNS: { key: ColumnKey; label: string; fixed?: boolean }[] = [
        { key: 'time', label: 'Time', fixed: true },
        { key: 'app', label: 'App' },
        { key: 'event', label: 'Event', fixed: true },
        { key: 'device', label: 'Device' },
        { key: 'version', label: 'Bundle' },
        { key: 'native', label: 'Native' },
        { key: 'os', label: 'OS' },
        { key: 'platform', label: 'Platform' },
        { key: 'channel', label: 'Channel' },
        { key: 'plugin', label: 'Plugin' },
        { key: 'country', label: 'Country' },
        { key: 'flags', label: 'Build' },
        { key: 'detail', label: 'Detail' }
    ];

    export const DEFAULT_COLUMNS: ColumnKey[] = [
        'time',
        'app',
        'event',
        'device',
        'version',
        'native',
        'platform',
        'channel'
    ];
</script>

<script lang="ts">
    import { ArrowRight, ExternalLink, Smartphone } from '@lucide/svelte';
    import { actionGroup, actionLabel } from '$lib/util/statsActions.js';
    import { CATEGORY_COLORS, resultInfo } from '$lib/util/updateResults.js';
    import { getExplorerRows } from '$lib/remote/explorer.remote.js';
    import { withValue, type DimKey, type ExplorerQuery, type ExplorerRow } from '$lib/util/explorer.js';
    import { fmtTime, localStamp, utcStamp, type TimeMode } from '$lib/util/time.js';

    let {
        q,
        qs,
        onchange,
        onopen,
        columns,
        timeMode,
        dense,
        collapse,
        live,
        selected
    }: {
        q: ExplorerQuery;
        qs: string;
        onchange: (next: ExplorerQuery) => void;
        onopen: (row: ExplorerRow) => void;
        columns: ColumnKey[];
        timeMode: TimeMode;
        dense: boolean;
        collapse: boolean;
        live: boolean;
        selected: string | null;
    } = $props();

    const PAGE = 100;
    const firstQuery = $derived(getExplorerRows({ qs, limit: PAGE }));
    const first = $derived(await firstQuery);

    // "Load more" pages for the current query string. Tagged with qs so a
    // filter change drops them without an effect.
    let extra = $state<{ qs: string; head: string; rows: ExplorerRow[]; next: string | null } | null>(null);
    const headKey = $derived(first.rows[0] ? first.rows[0].kind + first.rows[0].id : '');
    const extraValid = $derived(extra !== null && extra.qs === qs && extra.head === headKey);
    const rows = $derived(extraValid ? [...first.rows, ...extra!.rows] : first.rows);
    const next = $derived(extraValid ? extra!.next : first.next);
    let loadingMore = $state(false);

    async function loadMore() {
        if (!next || loadingMore) return;
        loadingMore = true;
        try {
            const p = await getExplorerRows({ qs, cursor: next, limit: PAGE });
            extra = { qs, head: headKey, rows: [...(extraValid ? extra!.rows : []), ...p.rows], next: p.next };
        } finally {
            loadingMore = false;
        }
    }

    // --- live tail ---------------------------------------------------------------
    $effect(() => {
        if (!live) return;
        const query = firstQuery;
        const id = setInterval(() => {
            // Don't shift rows under someone who scrolled down to read.
            if (document.hidden || window.scrollY > 400) return;
            query.refresh();
        }, 5000);
        return () => clearInterval(id);
    });

    let seenFor = '';
    let seen = new Set<string>();
    let fresh = $state<Set<string>>(new Set());
    $effect(() => {
        const ids = first.rows.map((r) => r.kind + r.id);
        if (seenFor !== qs) {
            seenFor = qs;
            seen = new Set(ids);
            fresh = new Set();
            return;
        }
        const nu = ids.filter((i) => !seen.has(i));
        for (const i of nu) seen.add(i);
        if (nu.length) fresh = new Set(nu);
    });

    // --- display -------------------------------------------------------------------
    type Display = { row: ExplorerRow; repeats: number; oldest: string; low?: string };

    const isProgress = (a: string | null) => !!a && /^download_\d+$/.test(a);

    function sameRun(a: ExplorerRow, b: ExplorerRow): boolean {
        // One download reports 0%, 10%, … 90%: fold the steps into one row.
        const progress = isProgress(a.action) && isProgress(b.action);
        return (
            a.kind === b.kind &&
            (progress || (a.action === b.action && a.result === b.result)) &&
            a.deviceId === b.deviceId &&
            a.versionName === b.versionName &&
            a.bundleVersion === b.bundleVersion
        );
    }

    const display = $derived.by(() => {
        const out: Display[] = [];
        for (const r of rows) {
            const prev = out.at(-1);
            if (collapse && prev && sameRun(prev.row, r)) {
                prev.repeats++;
                prev.oldest = r.at;
                if (isProgress(r.action)) prev.low = r.action!;
                continue;
            }
            out.push({ row: r, repeats: 1, oldest: r.at });
        }
        return out;
    });

    // The app column is noise when every row is the same app.
    const multiApp = $derived(new Set(rows.map((r) => r.appId)).size > 1);
    const visible = $derived(
        COLUMNS.filter((c) => (c.fixed || columns.includes(c.key)) && (c.key !== 'app' || multiApp))
    );

    function filter(e: MouseEvent, dim: DimKey, value: string | null) {
        e.stopPropagation();
        if (!value) return;
        onchange(withValue(q, dim, value, e.altKey || e.shiftKey ? 'out' : 'in'));
    }

    function eventColor(r: ExplorerRow): string {
        if (r.kind === 'check') return CATEGORY_COLORS[resultInfo(r.result ?? '').category];
        return actionGroup(r.action)?.color ?? 'var(--color-surface-500)';
    }

    function rowKey(r: ExplorerRow) {
        return `${r.kind}:${r.id}`;
    }

    const cellPad = $derived(dense ? 'py-1' : 'py-2');
</script>

{#snippet val(dim: DimKey, value: string | null, cls = '')}
    {#if value}
        <button
            type="button"
            class="hover:decoration-primary-500 cursor-pointer text-left decoration-dotted underline-offset-2 hover:underline {cls}"
            title="Filter by {value} (Alt-click to exclude)"
            onclick={(e) => filter(e, dim, value)}>{value}</button
        >
    {:else}
        <span class="text-surface-400-600">—</span>
    {/if}
{/snippet}

{#if rows.length === 0}
    <div class="card preset-filled-surface-100-900 text-surface-600-400 p-8 text-center text-sm">
        Nothing matches. Widen the time range or remove a filter.
        {#if !q.appState && q.source !== 'checks'}
            <br />App open/close events are hidden;
            <button type="button" class="underline" onclick={() => onchange({ ...q, appState: true })}>show them</button
            >.
        {/if}
    </div>
{:else}
    <div class="table-wrap">
        <table class="table text-sm">
            <thead>
                <tr>
                    {#each visible as c (c.key)}
                        <th class="whitespace-nowrap {cellPad}">{c.label}</th>
                    {/each}
                </tr>
            </thead>
            <tbody>
                {#each display as { row: r, repeats, oldest, low } (rowKey(r))}
                    <tr
                        class="hover:bg-surface-200-800/60 cursor-pointer transition-colors {fresh.has(r.kind + r.id)
                            ? 'bg-primary-500/10 animate-[pulse_1s_ease-in-out_2]'
                            : ''} {selected === rowKey(r) ? 'bg-primary-500/15' : ''}"
                        onclick={() => onopen(r)}
                    >
                        {#each visible as c (c.key)}
                            {#if c.key === 'time'}
                                <td
                                    class="text-surface-600-400 font-mono text-xs whitespace-nowrap {cellPad}"
                                    title="{localStamp(r.at, true)} local · {utcStamp(r.at)} UTC"
                                >
                                    {fmtTime(r.at, timeMode)}
                                    {#if repeats > 1}
                                        <span class="block text-[10px] opacity-75"
                                            >since {fmtTime(oldest, timeMode)}</span
                                        >
                                    {/if}
                                </td>
                            {:else if c.key === 'app'}
                                <td class="text-xs {cellPad}">{@render val('app', r.appId, 'font-mono')}</td>
                            {:else if c.key === 'event'}
                                <td class="whitespace-nowrap {cellPad}">
                                    <span class="inline-flex items-center gap-1.5">
                                        <span
                                            class="inline-block size-2 shrink-0 rounded-full"
                                            style:background={eventColor(r)}
                                        ></span>
                                        {#if r.kind === 'check'}
                                            <span
                                                class="badge preset-outlined-surface-300-700 px-1 py-0 text-[10px] uppercase"
                                                >check</span
                                            >
                                            <button
                                                type="button"
                                                class="hover:underline"
                                                title={r.result ?? ''}
                                                onclick={(e) => filter(e, 'result', r.result)}
                                                >{resultInfo(r.result ?? '').label}</button
                                            >
                                        {:else}
                                            <button
                                                type="button"
                                                class="hover:underline"
                                                title={r.action ?? ''}
                                                onclick={(e) => filter(e, 'action', r.action)}
                                                >{#if low && low !== r.action}Downloading · {low.slice(
                                                        9
                                                    )}–{r.action?.slice(9)}%{:else}{actionLabel(r.action)}{/if}</button
                                            >
                                        {/if}
                                        {#if repeats > 1}
                                            <span class="badge preset-tonal px-1.5 py-0 text-[10px]">×{repeats}</span>
                                        {/if}
                                    </span>
                                </td>
                            {:else if c.key === 'device'}
                                <td class="font-mono text-xs whitespace-nowrap {cellPad}">
                                    <span class="inline-flex items-center gap-1">
                                        <button
                                            type="button"
                                            class="hover:underline"
                                            title="{r.deviceId} — filter by this device"
                                            onclick={(e) => filter(e, 'device', r.deviceId)}
                                            >{r.deviceId.slice(0, 8)}</button
                                        >
                                        <a
                                            class="text-surface-500 hover:text-primary-500"
                                            href="/dashboard/apps/{r.appId}/devices/{r.deviceId}"
                                            title="Open device page"
                                            onclick={(e) => e.stopPropagation()}><ExternalLink class="size-3" /></a
                                        >
                                    </span>
                                    {#if r.customId}
                                        <span
                                            class="text-surface-600-400 block max-w-32 truncate font-sans text-[11px]"
                                            title={r.customId}>{r.customId}</span
                                        >
                                    {/if}
                                </td>
                            {:else if c.key === 'version'}
                                <td class="font-mono text-xs whitespace-nowrap {cellPad}">
                                    {#if r.kind === 'event' && r.oldVersionName && r.oldVersionName !== r.versionName}
                                        <span class="inline-flex items-center gap-1">
                                            {@render val('version', r.oldVersionName, 'text-surface-600-400')}
                                            <ArrowRight class="size-3 opacity-60" />
                                            {@render val('version', r.versionName)}
                                        </span>
                                    {:else if r.kind === 'check' && r.bundleVersion}
                                        <span class="inline-flex items-center gap-1">
                                            {@render val('version', r.versionName, 'text-surface-600-400')}
                                            <ArrowRight class="size-3 opacity-60" />
                                            {@render val('bundle', r.bundleVersion, 'text-primary-500')}
                                        </span>
                                    {:else}
                                        {@render val('version', r.versionName)}
                                    {/if}
                                </td>
                            {:else if c.key === 'native'}
                                <td class="font-mono text-xs {cellPad}">
                                    {@render val('native', r.versionBuild)}
                                    {#if r.versionCode}<span class="text-surface-600-400 block text-[10px]"
                                            >code {r.versionCode}</span
                                        >{/if}
                                </td>
                            {:else if c.key === 'os'}
                                <td class="font-mono text-xs {cellPad}">{@render val('os', r.versionOs)}</td>
                            {:else if c.key === 'platform'}
                                <td class="text-xs {cellPad}">
                                    <span class="inline-flex items-center gap-1">
                                        <Smartphone class="size-3 opacity-50" />{@render val('platform', r.platform)}
                                    </span>
                                </td>
                            {:else if c.key === 'channel'}
                                <td class="text-xs {cellPad}">{@render val('channel', r.channel)}</td>
                            {:else if c.key === 'plugin'}
                                <td class="font-mono text-xs {cellPad}">{@render val('plugin', r.pluginVersion)}</td>
                            {:else if c.key === 'country'}
                                <td class="text-xs {cellPad}">{@render val('country', r.country)}</td>
                            {:else if c.key === 'flags'}
                                <td class="text-xs whitespace-nowrap {cellPad}">
                                    {#if r.isProd !== null}
                                        <span
                                            class="badge {r.isProd
                                                ? 'preset-tonal'
                                                : 'preset-tonal-warning'} px-1.5 py-0 text-[10px]"
                                            >{r.isProd ? 'release' : 'debug'}</span
                                        >
                                    {/if}
                                    {#if r.isEmulator}<span class="badge preset-tonal-tertiary px-1.5 py-0 text-[10px]"
                                            >emulator</span
                                        >{/if}
                                </td>
                            {:else if c.key === 'detail'}
                                <td
                                    class="text-surface-600-400 max-w-64 truncate font-mono text-xs {cellPad}"
                                    title={r.detail ?? ''}
                                >
                                    {r.detail ??
                                        (r.kind === 'check' && r.candidates !== null
                                            ? `${r.candidates} candidates`
                                            : '')}
                                </td>
                            {/if}
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span class="text-surface-600-400">
            {rows.length.toLocaleString()} rows loaded{collapse && display.length < rows.length
                ? ` · ${display.length.toLocaleString()} after collapsing repeats`
                : ''}
        </span>
        {#if next}
            <button type="button" class="btn btn-sm preset-tonal" onclick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load ${PAGE} more`}
            </button>
        {:else}
            <span class="text-surface-600-400">End of results.</span>
        {/if}
    </div>
{/if}
