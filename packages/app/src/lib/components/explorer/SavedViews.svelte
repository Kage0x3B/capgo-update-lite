<script lang="ts">
    import { onMount } from 'svelte';
    import { Bookmark, Save, Trash2 } from '@lucide/svelte';
    import { Persisted } from '$lib/util/persisted.svelte.js';

    let { qs, onpick }: { qs: string; onpick: (qs: string) => void } = $props();

    type View = { name: string; qs: string };

    const BUILT_IN: View[] = [
        { name: 'Failures', qs: 'action=@failure' },
        { name: 'Installs', qs: 'action=set' },
        { name: 'Downloads', qs: 'action=@download' },
        { name: 'Blocked by the server', qs: 'src=checks&result=@blocked' },
        { name: 'Updates served', qs: 'src=checks&result=update' },
        { name: 'Everything (incl. app state)', qs: 'src=all&appstate=1' }
    ];

    const saved = new Persisted<View[]>('explorer.views', []);
    onMount(() => saved.load((v, init) => (Array.isArray(v) ? (v as View[]) : init)));

    let open = $state(false);
    let root: HTMLDivElement | undefined = $state();

    function save() {
        const name = prompt('Name this view');
        if (!name?.trim()) return;
        saved.value = [...saved.value.filter((v) => v.name !== name.trim()), { name: name.trim(), qs }];
    }

    function remove(name: string) {
        saved.value = saved.value.filter((v) => v.name !== name);
    }

    function pick(v: View) {
        onpick(v.qs);
        open = false;
    }

    function onWindowClick(e: MouseEvent) {
        if (open && root && !root.contains(e.target as Node)) open = false;
    }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="relative" bind:this={root}>
    <button type="button" class="btn btn-sm preset-tonal" onclick={() => (open = !open)} aria-expanded={open}>
        <Bookmark class="size-4" /> Views
    </button>
    {#if open}
        <div
            class="card preset-filled-surface-50-950 border-surface-200-800 absolute top-full right-0 z-40 mt-2 w-64 border p-2 text-sm shadow-xl"
        >
            <div class="text-surface-600-400 px-2 pt-1 pb-1 text-xs tracking-wide uppercase">Presets</div>
            {#each BUILT_IN as v}
                <button
                    type="button"
                    class="hover:bg-surface-200-800 block w-full rounded px-2 py-1.5 text-left {v.qs === qs
                        ? 'text-primary-500 font-medium'
                        : ''}"
                    onclick={() => pick(v)}>{v.name}</button
                >
            {/each}
            <div
                class="text-surface-600-400 border-surface-200-800 mt-2 border-t px-2 pt-2 pb-1 text-xs tracking-wide uppercase"
            >
                Saved in this browser
            </div>
            {#each saved.value as v (v.name)}
                <div class="hover:bg-surface-200-800 flex items-center rounded">
                    <button
                        type="button"
                        class="min-w-0 flex-1 truncate px-2 py-1.5 text-left {v.qs === qs
                            ? 'text-primary-500 font-medium'
                            : ''}"
                        title={v.qs || '(defaults)'}
                        onclick={() => pick(v)}>{v.name}</button
                    >
                    <button
                        type="button"
                        class="text-surface-600-400 hover:text-error-500 px-2"
                        aria-label="Delete view {v.name}"
                        onclick={() => remove(v.name)}
                    >
                        <Trash2 class="size-3.5" />
                    </button>
                </div>
            {:else}
                <p class="text-surface-600-400 px-2 py-1 text-xs">None yet.</p>
            {/each}
            <button type="button" class="btn btn-sm preset-tonal mt-2 w-full" onclick={save}>
                <Save class="size-4" /> Save current view
            </button>
        </div>
    {/if}
</div>
