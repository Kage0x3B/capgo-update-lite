<script lang="ts">
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { Columns3, Download, Radio, Search } from '@lucide/svelte';
    import AddFilter from '$lib/components/explorer/AddFilter.svelte';
    import EventTable, { COLUMNS, DEFAULT_COLUMNS, type ColumnKey } from '$lib/components/explorer/EventTable.svelte';
    import FacetPanel from '$lib/components/explorer/FacetPanel.svelte';
    import FilterChips from '$lib/components/explorer/FilterChips.svelte';
    import GroupTable from '$lib/components/explorer/GroupTable.svelte';
    import Histogram from '$lib/components/explorer/Histogram.svelte';
    import RowDrawer from '$lib/components/explorer/RowDrawer.svelte';
    import SavedViews from '$lib/components/explorer/SavedViews.svelte';
    import SummaryStrip from '$lib/components/explorer/SummaryStrip.svelte';
    import TimeRange from '$lib/components/explorer/TimeRange.svelte';
    import { getExplorerFacets } from '$lib/remote/explorer.remote.js';
    import { startClock } from '$lib/util/clock.svelte.js';
    import {
        DIM_BY_KEY,
        DIMENSIONS,
        parseQuery,
        readableQuery,
        SOURCES,
        toParams,
        toQueryString,
        type DimKey,
        type ExplorerQuery,
        type ExplorerRow,
        type Flag
    } from '$lib/util/explorer.js';
    import { Persisted } from '$lib/util/persisted.svelte.js';
    import type { TimeMode } from '$lib/util/time.js';

    // --- URL state -----------------------------------------------------------------
    const q = $derived(parseQuery(page.url.searchParams));
    const qs = $derived(toQueryString(q));
    // Page-only params: they change the view, not the data filter.
    const view = $derived(page.url.searchParams.get('view') === 'group' ? 'group' : 'rows');
    const groupBy = $derived.by((): DimKey => {
        const b = page.url.searchParams.get('by');
        return DIM_BY_KEY.has(b as DimKey) ? (b as DimKey) : 'device';
    });
    const selected = $derived(page.url.searchParams.get('row'));
    const selectedParts = $derived.by(() => {
        const m = selected?.match(/^(event|check):(\d+)$/);
        return m ? { kind: m[1] as 'event' | 'check', id: m[2] } : null;
    });

    function navigate(params: URLSearchParams, opts: { replace?: boolean } = {}) {
        const s = readableQuery(params);
        goto(s ? `?${s}` : page.url.pathname, { keepFocus: true, noScroll: true, replaceState: opts.replace });
    }

    /** Apply a new filter state. Keeps the view mode, closes the drawer. */
    function setQuery(next: ExplorerQuery) {
        const p = toParams(next);
        if (view === 'group') {
            p.set('view', 'group');
            p.set('by', groupBy);
        }
        navigate(p);
    }

    function setPageParam(key: string, value: string | null, replace = false) {
        const p = new URLSearchParams(page.url.searchParams);
        if (value === null) p.delete(key);
        else p.set(key, value);
        navigate(p, { replace });
    }

    function openRow(r: ExplorerRow) {
        setPageParam('row', `${r.kind}:${r.id}`, selected !== null);
    }

    // --- preferences (this browser) -------------------------------------------------
    const columns = new Persisted<ColumnKey[]>('explorer.columns', DEFAULT_COLUMNS);
    const timeMode = new Persisted<TimeMode>('explorer.time', 'relative');
    const dense = new Persisted<boolean>('explorer.dense', false);
    const collapse = new Persisted<boolean>('explorer.collapse', true);

    onMount(() => {
        columns.load((v, init) => (Array.isArray(v) ? (v as ColumnKey[]) : init));
        timeMode.load();
        dense.load();
        collapse.load();
        return startClock();
    });

    let live = $state(false);
    const liveAllowed = $derived(q.range !== 'custom');

    // --- search box (debounced) ----------------------------------------------------
    let search = $state('');
    $effect(() => {
        search = q.q;
    });
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    function onSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            if (search.trim() !== q.q) setQuery({ ...q, q: search.trim() });
        }, 350);
    }

    let columnsOpen = $state(false);
    function toggleColumn(k: ColumnKey) {
        columns.value = columns.value.includes(k) ? columns.value.filter((c) => c !== k) : [...columns.value, k];
    }

    const flagOptions: { value: Flag; label: string }[] = [
        { value: 'any', label: 'any' },
        { value: 'yes', label: 'yes' },
        { value: 'no', label: 'no' }
    ];

    const exportBase = $derived(`/dashboard/stats/export?${qs}${qs ? '&' : ''}format=`);
</script>

<svelte:head>
    <title>Stats — capgo-update-lite</title>
</svelte:head>

{#snippet loading(h = 'h-24')}
    <div class="card preset-filled-surface-100-900 {h} animate-pulse"></div>
{/snippet}
{#snippet errorBox(error: unknown, reset: () => void)}
    <div class="card preset-tonal-error flex items-center justify-between gap-3 p-3 text-sm">
        <span>Could not load: {error instanceof Error ? error.message : String(error)}</span>
        <button class="btn btn-sm preset-tonal" onclick={reset}>Retry</button>
    </div>
{/snippet}

<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
        <h1 class="h3 sm:h2">Stats</h1>
        <p class="text-surface-600-400 text-sm">Plugin events and update checks from every device. Newest first.</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
        <SavedViews {qs} onpick={(s) => navigate(new URLSearchParams(s))} />
        <button
            type="button"
            class="btn btn-sm {live && liveAllowed ? 'preset-filled-success-500' : 'preset-tonal'}"
            disabled={!liveAllowed}
            title={liveAllowed
                ? 'Fetch new rows every 5 s while at the top of the page'
                : 'Live needs a relative time range'}
            onclick={() => (live = !live)}
        >
            <Radio class="size-4 {live && liveAllowed ? 'animate-pulse' : ''}" />
            {live && liveAllowed ? 'Live' : 'Go live'}
        </button>
        <div class="flex">
            <a class="btn btn-sm preset-tonal rounded-r-none" href="{exportBase}csv" download title="Up to 50,000 rows">
                <Download class="size-4" /> CSV
            </a>
            <a
                class="btn btn-sm preset-tonal border-surface-300-700 rounded-l-none border-l"
                href="{exportBase}json"
                download>JSON</a
            >
        </div>
    </div>
</header>

<section class="card preset-filled-surface-100-900 mb-4 space-y-3 p-3">
    <div class="flex flex-wrap items-center gap-2">
        <div class="bg-surface-200-800 inline-flex rounded-lg p-0.5 text-sm" role="group" aria-label="Source">
            {#each SOURCES as s}
                <button
                    type="button"
                    class="rounded-md px-2.5 py-1 transition {q.source === s.key
                        ? 'preset-filled-primary-500'
                        : 'text-surface-700-300 hover:text-surface-950-50'}"
                    onclick={() => setQuery({ ...q, source: s.key })}>{s.label}</button
                >
            {/each}
        </div>
        <TimeRange {q} onchange={setQuery} />
    </div>
    <div class="flex flex-wrap items-center gap-2">
        <label class="relative min-w-48 flex-1 sm:max-w-xs">
            <Search class="text-surface-500 pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <input
                class="input py-1 pl-8 text-sm"
                bind:value={search}
                oninput={onSearch}
                placeholder="Device id or custom id prefix"
                aria-label="Search devices"
            />
        </label>
        <AddFilter {q} facets={getExplorerFacets({ qs }).current} onchange={setQuery} />
        {#if q.source !== 'checks'}
            <label
                class="flex items-center gap-1.5 text-sm"
                title="App foregrounded / backgrounded events, ~75% of all traffic"
            >
                <input
                    class="checkbox"
                    type="checkbox"
                    checked={q.appState}
                    onchange={(e) => setQuery({ ...q, appState: e.currentTarget.checked })}
                />
                Show app open/close
            </label>
        {/if}
        <label class="flex items-center gap-1.5 text-sm">
            Release
            <select
                class="select w-auto py-0.5 text-sm"
                value={q.prod}
                onchange={(e) => setQuery({ ...q, prod: e.currentTarget.value as Flag })}
            >
                {#each flagOptions as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
        </label>
        <label class="flex items-center gap-1.5 text-sm">
            Emulator
            <select
                class="select w-auto py-0.5 text-sm"
                value={q.emulator}
                onchange={(e) => setQuery({ ...q, emulator: e.currentTarget.value as Flag })}
            >
                {#each flagOptions as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
        </label>
    </div>
    <FilterChips {q} onchange={setQuery} />
</section>

<section class="mb-4">
    <svelte:boundary>
        <SummaryStrip {q} {qs} />
        {#snippet pending()}{@render loading('h-[86px]')}{/snippet}
        {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
    </svelte:boundary>
</section>

<section class="mb-4">
    <svelte:boundary>
        <Histogram {q} {qs} onchange={setQuery} />
        {#snippet pending()}{@render loading('h-[228px]')}{/snippet}
        {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
    </svelte:boundary>
</section>

<div class="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
    <aside class="order-2 lg:order-1">
        <details class="card preset-filled-surface-100-900 p-3 lg:hidden">
            <summary class="cursor-pointer text-sm font-medium">Breakdown</summary>
            <div class="mt-3">
                <svelte:boundary>
                    <FacetPanel {q} {qs} onchange={setQuery} />
                    {#snippet pending()}{@render loading('h-64')}{/snippet}
                    {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
                </svelte:boundary>
            </div>
        </details>
        <div class="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
            <svelte:boundary>
                <FacetPanel {q} {qs} onchange={setQuery} />
                {#snippet pending()}{@render loading('h-96')}{/snippet}
                {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
            </svelte:boundary>
        </div>
    </aside>

    <section class="order-1 min-w-0 lg:order-2">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div class="flex flex-wrap items-center gap-2">
                <div class="bg-surface-200-800 inline-flex rounded-lg p-0.5" role="group" aria-label="View">
                    <button
                        type="button"
                        class="rounded-md px-2.5 py-1 {view === 'rows'
                            ? 'preset-filled-surface-50-950 shadow'
                            : 'text-surface-700-300'}"
                        onclick={() => setPageParam('view', null)}>Rows</button
                    >
                    <button
                        type="button"
                        class="rounded-md px-2.5 py-1 {view === 'group'
                            ? 'preset-filled-surface-50-950 shadow'
                            : 'text-surface-700-300'}"
                        onclick={() => setPageParam('view', 'group')}>Group</button
                    >
                </div>
                {#if view === 'group'}
                    <label class="flex items-center gap-1.5">
                        by
                        <select
                            class="select w-auto py-0.5 text-sm"
                            value={groupBy}
                            onchange={(e) => setPageParam('by', e.currentTarget.value)}
                        >
                            {#each DIMENSIONS as d}<option value={d.key}>{d.label}</option>{/each}
                        </select>
                    </label>
                {:else}
                    <label class="flex items-center gap-1.5" title="Merge consecutive identical rows from one device">
                        <input class="checkbox" type="checkbox" bind:checked={collapse.value} />
                        Collapse repeats
                    </label>
                {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select class="select w-auto py-0.5 text-sm" bind:value={timeMode.value} aria-label="Time format">
                    <option value="relative">Relative time</option>
                    <option value="local">Local time</option>
                    <option value="utc">UTC</option>
                </select>
                {#if view === 'rows'}
                    <label class="flex items-center gap-1.5">
                        <input class="checkbox" type="checkbox" bind:checked={dense.value} />
                        Compact
                    </label>
                    <div class="relative">
                        <button
                            type="button"
                            class="btn btn-sm preset-tonal"
                            onclick={() => (columnsOpen = !columnsOpen)}
                        >
                            <Columns3 class="size-4" /> Columns
                        </button>
                        {#if columnsOpen}
                            <div
                                class="card preset-filled-surface-50-950 border-surface-200-800 absolute top-full right-0 z-30 mt-2 w-48 space-y-1 border p-2 shadow-xl"
                            >
                                {#each COLUMNS.filter((c) => !c.fixed) as c}
                                    <label class="hover:bg-surface-200-800 flex items-center gap-2 rounded px-1.5 py-1">
                                        <input
                                            class="checkbox"
                                            type="checkbox"
                                            checked={columns.value.includes(c.key)}
                                            onchange={() => toggleColumn(c.key)}
                                        />
                                        {c.label}
                                    </label>
                                {/each}
                                <button
                                    type="button"
                                    class="btn btn-sm preset-tonal mt-1 w-full"
                                    onclick={() => (columns.value = DEFAULT_COLUMNS)}>Reset</button
                                >
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>

        <svelte:boundary>
            {#if view === 'group'}
                <GroupTable {q} {qs} by={groupBy} timeMode={timeMode.value} onchange={(n) => setQuery(n)} />
            {:else}
                <EventTable
                    {q}
                    {qs}
                    onchange={setQuery}
                    onopen={openRow}
                    columns={columns.value}
                    timeMode={timeMode.value}
                    dense={dense.value}
                    collapse={collapse.value}
                    live={live && liveAllowed}
                    {selected}
                />
            {/if}
            {#snippet pending()}{@render loading('h-96')}{/snippet}
            {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
        </svelte:boundary>
    </section>
</div>

{#if selectedParts}
    <svelte:boundary>
        <RowDrawer
            kind={selectedParts.kind}
            id={selectedParts.id}
            {q}
            onchange={setQuery}
            onclose={() => setPageParam('row', null)}
            onselect={(r) => setPageParam('row', `${r.kind}:${r.id}`, true)}
        />
        {#snippet failed(e, reset)}{@render errorBox(e, reset)}{/snippet}
    </svelte:boundary>
{/if}
