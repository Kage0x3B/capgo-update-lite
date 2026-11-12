<script lang="ts">
    import { Calendar } from '@lucide/svelte';
    import { RANGE_PRESETS, type ExplorerQuery } from '$lib/util/explorer.js';
    import { fromLocalInput, localStamp, toLocalInput } from '$lib/util/time.js';

    let { q, onchange }: { q: ExplorerQuery; onchange: (next: ExplorerQuery) => void } = $props();

    let open = $state(false);
    let from = $state('');
    let to = $state('');

    function openCustom() {
        const now = Date.now();
        from = toLocalInput(q.from ?? new Date(now - 86_400_000).toISOString());
        to = toLocalInput(q.to ?? new Date(now).toISOString());
        open = !open;
    }

    function applyCustom(e: SubmitEvent) {
        e.preventDefault();
        const f = fromLocalInput(from);
        if (!f) return;
        onchange({ ...q, range: 'custom', from: f, to: fromLocalInput(to) });
        open = false;
    }

    const customLabel = $derived(
        q.range === 'custom' && q.from
            ? `${localStamp(q.from).slice(0, 16)} → ${q.to ? localStamp(q.to).slice(0, 16) : 'now'}`
            : 'Custom'
    );
</script>

<div class="relative flex max-w-full min-w-0 flex-wrap items-center gap-2">
    <div
        class="bg-surface-200-800 inline-flex max-w-full overflow-x-auto rounded-lg p-0.5 text-sm whitespace-nowrap"
        role="group"
        aria-label="Time range"
    >
        {#each RANGE_PRESETS as r}
            <button
                type="button"
                onclick={() => onchange({ ...q, range: r, from: undefined, to: undefined })}
                class="rounded-md px-2.5 py-1 tabular-nums transition {q.range === r
                    ? 'preset-filled-primary-500'
                    : 'text-surface-700-300 hover:text-surface-950-50'}"
            >
                {r}
            </button>
        {/each}
        <button
            type="button"
            onclick={openCustom}
            class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition {q.range === 'custom'
                ? 'preset-filled-primary-500'
                : 'text-surface-700-300 hover:text-surface-950-50'}"
        >
            <Calendar class="size-3.5" />
            <span class="tabular-nums">{customLabel}</span>
        </button>
    </div>

    {#if open}
        <form
            class="card preset-filled-surface-50-950 border-surface-200-800 absolute top-full left-0 z-40 mt-2 flex flex-col gap-3 border p-3 shadow-xl sm:flex-row sm:items-end"
            onsubmit={applyCustom}
        >
            <label class="label">
                <span class="label-text text-xs">From</span>
                <input class="input py-1 text-sm" type="datetime-local" bind:value={from} required />
            </label>
            <label class="label">
                <span class="label-text text-xs">To (empty = now)</span>
                <input class="input py-1 text-sm" type="datetime-local" bind:value={to} />
            </label>
            <div class="flex gap-2">
                <button class="btn btn-sm preset-filled-primary-500" type="submit">Apply</button>
                <button class="btn btn-sm preset-tonal" type="button" onclick={() => (open = false)}>Cancel</button>
            </div>
        </form>
    {/if}
</div>
