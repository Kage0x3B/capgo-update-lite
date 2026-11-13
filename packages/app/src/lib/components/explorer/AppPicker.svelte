<script lang="ts" module>
    import type { ExplorerQuery } from '$lib/util/explorer.js';

    /** The one app the query is pinned to, or null for "all apps" / a mixed app filter. */
    export function pinnedApp(q: ExplorerQuery): string | null {
        const f = q.dims.app;
        return f && f.in.length === 1 && f.out.length === 0 && !f.in[0].startsWith('~') ? f.in[0] : null;
    }
</script>

<script lang="ts">
    import { ExternalLink, Smartphone } from '@lucide/svelte';
    import { getApps } from '../../../routes/dashboard/apps/apps.remote.js';

    let { q, onpick }: { q: ExplorerQuery; onpick: (appId: string | null) => void } = $props();

    const pinned = $derived(pinnedApp(q));
    const mixed = $derived(!pinned && !!q.dims.app);
    const value = $derived(pinned ?? (mixed ? '__mixed' : ''));
    const apps = $derived(await getApps());
    const known = $derived(new Set(apps.map((a) => a.id)));
    const current = $derived(apps.find((a) => a.id === pinned));

    function pick(v: string) {
        if (v === '__mixed') return;
        onpick(v || null);
    }
</script>

<div class="flex min-w-0 items-center gap-2">
    <Smartphone class="text-primary-500 size-6 shrink-0" />
    <select
        {value}
        class="select border-primary-500/40 min-w-0 flex-1 py-1.5 text-base font-semibold sm:w-auto sm:min-w-72 sm:flex-none sm:text-lg"
        onchange={(e) => pick(e.currentTarget.value)}
        aria-label="App"
    >
        <option value="">All apps</option>
        {#if mixed}<option value="__mixed" disabled>Custom app filter (see chips)</option>{/if}
        {#if pinned && !known.has(pinned)}<option value={pinned}>{pinned}</option>{/if}
        {#each apps as a (a.id)}
            <option value={a.id}>{a.name} · {a.id}</option>
        {/each}
    </select>
    {#if current}
        <a
            class="btn-icon btn-icon-sm hover:preset-tonal shrink-0"
            href="/dashboard/apps/{current.id}"
            title="Open app settings"
            aria-label="Open {current.name}"><ExternalLink class="size-4" /></a
        >
    {/if}
</div>
