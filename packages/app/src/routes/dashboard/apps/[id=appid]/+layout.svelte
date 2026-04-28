<script lang="ts">
    import { page } from '$app/state';
    import { ArrowLeft } from '@lucide/svelte';

    let { children } = $props();

    const appId = $derived(page.params.id ?? '');

    type Tab = { href: (id: string) => string; label: string; match: (path: string, id: string) => boolean };
    const tabs: Tab[] = [
        {
            href: (id) => `/dashboard/apps/${id}`,
            label: 'Bundles',
            match: (path, id) => path === `/dashboard/apps/${id}`
        },
        {
            href: (id) => `/dashboard/apps/${id}/stats`,
            label: 'Stats',
            match: (path, id) => path.startsWith(`/dashboard/apps/${id}/stats`)
        },
        {
            href: (id) => `/dashboard/apps/${id}/settings`,
            label: 'Settings',
            match: (path, id) => path.startsWith(`/dashboard/apps/${id}/settings`)
        }
    ];
</script>

<header class="mb-6">
    <p class="text-surface-600-400 text-xs">
        <a class="anchor inline-flex items-center gap-1" href="/dashboard/apps">
            <ArrowLeft class="size-3" /> All apps
        </a>
    </p>
    <h1 class="min-w-0 break-words">
        <code class="text-lg break-all sm:text-2xl md:text-3xl">{appId}</code>
    </h1>
    <nav class="border-surface-200-800 mt-4 flex gap-5 border-b text-sm">
        {#each tabs as tab}
            {@const active = tab.match(page.url.pathname, appId)}
            {#if active}
                <span class="border-primary-500 text-primary-500 -mb-px border-b-2 px-1 pb-2 font-semibold">
                    {tab.label}
                </span>
            {:else}
                <a
                    href={tab.href(appId)}
                    class="text-surface-600-400 hover:text-surface-950-50 -mb-px border-b-2 border-transparent px-1 pb-2"
                >
                    {tab.label}
                </a>
            {/if}
        {/each}
    </nav>
</header>

{@render children?.()}
