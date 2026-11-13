<script lang="ts">
    import { X } from '@lucide/svelte';
    import { pinnedApp } from './AppPicker.svelte';
    import {
        DIMENSIONS,
        valueLabel,
        withoutValue,
        withValue,
        type DimKey,
        type ExplorerQuery
    } from '$lib/util/explorer.js';

    let { q, onchange }: { q: ExplorerQuery; onchange: (next: ExplorerQuery) => void } = $props();

    type Chip = {
        key: string;
        dim?: DimKey;
        value?: string;
        label: string;
        text: string;
        exclude: boolean;
        remove: () => void;
    };

    const chips = $derived.by(() => {
        const out: Chip[] = [];
        for (const d of DIMENSIONS) {
            const f = q.dims[d.key];
            if (!f) continue;
            // A single picked app lives in the app picker at the top, not here.
            if (d.key === 'app' && pinnedApp(q)) continue;
            for (const v of f.in) {
                out.push({
                    key: `${d.key}:${v}`,
                    dim: d.key,
                    value: v,
                    label: d.label,
                    text: valueLabel(d.key, v),
                    exclude: false,
                    remove: () => onchange(withoutValue(q, d.key, v))
                });
            }
            for (const v of f.out) {
                out.push({
                    key: `${d.key}:!${v}`,
                    dim: d.key,
                    value: v,
                    label: d.label,
                    text: valueLabel(d.key, v),
                    exclude: true,
                    remove: () => onchange(withoutValue(q, d.key, v))
                });
            }
        }
        if (q.q) out.push(chip('q', 'Device / custom id', `${q.q}…`, () => onchange({ ...q, q: '' })));
        if (q.prod !== 'any')
            out.push(
                chip('prod', 'Build', q.prod === 'yes' ? 'release' : 'debug', () => onchange({ ...q, prod: 'any' }))
            );
        if (q.emulator !== 'any')
            out.push(
                chip('emu', 'Emulator', q.emulator === 'yes' ? 'yes' : 'no', () => onchange({ ...q, emulator: 'any' }))
            );
        return out;
    });

    function chip(key: string, label: string, text: string, remove: () => void): Chip {
        return { key, label, text, exclude: false, remove };
    }

    /** Clicking the chip body flips include ↔ exclude. */
    function flip(c: Chip) {
        if (!c.dim || c.value === undefined) return;
        onchange(withValue(q, c.dim, c.value, c.exclude ? 'in' : 'out'));
    }

    function clearAll() {
        // Keep the app: it is picked separately and everything else narrows within it.
        const app = pinnedApp(q);
        onchange({ ...q, dims: app ? { app: q.dims.app } : {}, q: '', prod: 'any', emulator: 'any' });
    }
</script>

{#if chips.length}
    <div class="flex flex-wrap items-center gap-1.5">
        {#each chips as c (c.key)}
            <span
                class="inline-flex items-center overflow-hidden rounded-full border text-xs {c.exclude
                    ? 'border-error-500/50 bg-error-500/10'
                    : 'border-primary-500/40 bg-primary-500/10'}"
            >
                <button
                    type="button"
                    class="flex items-center gap-1 py-1 pr-1 pl-2.5 {c.dim ? 'hover:underline' : 'cursor-default'}"
                    title={c.dim
                        ? c.exclude
                            ? 'Excluded. Click to include instead.'
                            : 'Click to exclude instead.'
                        : ''}
                    onclick={() => flip(c)}
                >
                    <span class="text-surface-600-400">{c.label}</span>
                    <span class={c.exclude ? 'text-error-600-400' : ''}>{c.exclude ? '≠' : '='}</span>
                    <span class="font-medium {c.exclude ? 'line-through decoration-1' : ''}">{c.text}</span>
                </button>
                <button
                    type="button"
                    class="hover:bg-surface-500/20 py-1 pr-2 pl-1"
                    aria-label="Remove filter {c.label} {c.text}"
                    onclick={c.remove}
                >
                    <X class="size-3" />
                </button>
            </span>
        {/each}
        <button
            type="button"
            class="text-surface-600-400 hover:text-surface-950-50 px-2 text-xs underline"
            onclick={clearAll}
        >
            Clear all
        </button>
    </div>
{/if}
