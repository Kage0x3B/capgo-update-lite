<script lang="ts">
    import { Plus } from '@lucide/svelte';
    import { ACTION_GROUPS, ALLOWED_STATS_ACTIONS, actionLabel } from '$lib/util/statsActions.js';
    import { CATEGORY_LABELS, CATEGORY_ORDER, RESULT_CODES, resultLabel } from '$lib/util/updateResults.js';
    import { DIMENSIONS, withValue, type DimKey, type ExplorerQuery, type Facets } from '$lib/util/explorer.js';

    let {
        q,
        facets,
        onchange
    }: { q: ExplorerQuery; facets: Facets | undefined; onchange: (next: ExplorerQuery) => void } = $props();

    let open = $state(false);
    let dim = $state<DimKey>('action');
    let value = $state('');
    let mode = $state<'in' | 'out'>('in');
    let root: HTMLDivElement | undefined = $state();

    // Known values per dimension: fixed enums where we have them, else the
    // current facet's top values.
    const suggestions = $derived.by((): { value: string; label: string }[] => {
        if (dim === 'action') return ALLOWED_STATS_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }));
        if (dim === 'result') return RESULT_CODES.map((r) => ({ value: r, label: resultLabel(r) }));
        return (facets?.[dim] ?? []).map((f) => ({ value: f.value, label: f.value }));
    });

    const groups = $derived.by((): { token: string; label: string }[] => {
        if (dim === 'action') return ACTION_GROUPS.map((g) => ({ token: '@' + g.key, label: g.label }));
        if (dim === 'result') return CATEGORY_ORDER.map((c) => ({ token: '@' + c, label: CATEGORY_LABELS[c] }));
        return [];
    });

    function add(v: string) {
        const t = v.trim();
        if (!t) return;
        onchange(withValue(q, dim, t, mode));
        value = '';
        open = false;
    }

    function submit(e: SubmitEvent) {
        e.preventDefault();
        // Accept a friendly label typed from the datalist too.
        const hit = suggestions.find((s) => s.label.toLowerCase() === value.trim().toLowerCase());
        add(hit ? hit.value : value);
    }

    function onWindowClick(e: MouseEvent) {
        if (open && root && !root.contains(e.target as Node)) open = false;
    }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="relative" bind:this={root}>
    <button type="button" class="btn btn-sm preset-tonal" onclick={() => (open = !open)} aria-expanded={open}>
        <Plus class="size-4" /> Filter
    </button>
    {#if open}
        <form
            class="card preset-filled-surface-50-950 border-surface-200-800 absolute top-full left-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 border p-3 shadow-xl"
            onsubmit={submit}
        >
            <div class="grid grid-cols-2 gap-2">
                <label class="label">
                    <span class="label-text text-xs">Field</span>
                    <select class="select py-1 text-sm" bind:value={dim} onchange={() => (value = '')}>
                        {#each DIMENSIONS as d}
                            <option value={d.key}>{d.label}</option>
                        {/each}
                    </select>
                </label>
                <label class="label">
                    <span class="label-text text-xs">Match</span>
                    <select class="select py-1 text-sm" bind:value={mode}>
                        <option value="in">is</option>
                        <option value="out">is not</option>
                    </select>
                </label>
            </div>

            {#if groups.length}
                <div>
                    <div class="text-surface-600-400 mb-1 text-xs">Groups</div>
                    <div class="flex flex-wrap gap-1">
                        {#each groups as g}
                            <button type="button" class="chip preset-tonal text-xs" onclick={() => add(g.token)}>
                                {g.label}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            <label class="label">
                <span class="label-text text-xs">Value</span>
                <input
                    class="input py-1 text-sm"
                    list="explorer-values"
                    bind:value
                    placeholder={dim === 'device' ? 'full device id' : 'type or pick'}
                    autocomplete="off"
                />
                <datalist id="explorer-values">
                    {#each suggestions as s}
                        <option value={s.label === s.value ? s.value : s.label}>{s.value}</option>
                    {/each}
                </datalist>
            </label>
            <div class="flex justify-end gap-2">
                <button type="button" class="btn btn-sm preset-tonal" onclick={() => (open = false)}>Cancel</button>
                <button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={!value.trim()}>Add</button>
            </div>
        </form>
    {/if}
</div>
