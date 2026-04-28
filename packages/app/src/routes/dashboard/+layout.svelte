<script lang="ts">
    import { afterNavigate } from '$app/navigation';
    import { page } from '$app/state';
    import { Layers, LogOut, Menu, X } from '@lucide/svelte';
    import { AppBar, Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
    import Lightswitch from '$lib/components/Lightswitch.svelte';

    let { data, children } = $props();

    const baseNav = [
        { href: '/dashboard', label: 'Overview', exact: true },
        { href: '/dashboard/apps', label: 'Apps' },
        { href: '/dashboard/stats', label: 'Stats' },
        { href: '/dashboard/cli', label: 'CLI' }
    ];
    // Admin-only entries are hidden from viewer/publisher sessions. The route
    // itself also enforces the role, so visiting the URL directly still 403s.
    const nav = $derived(
        data.auth?.role === 'admin' ? [...baseNav, { href: '/dashboard/admin/tokens', label: 'Tokens' }] : baseNav
    );

    const isLogin = $derived(page.url.pathname === '/dashboard/login');

    function isActive(href: string, exact?: boolean): boolean {
        return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
    }

    let drawerOpen = $state(false);
    afterNavigate(() => (drawerOpen = false));

    const animBackdrop =
        'transition transition-discrete opacity-0 starting:data-[state=open]:opacity-0 data-[state=open]:opacity-100';
    const animDrawer =
        'transition transition-discrete opacity-0 translate-x-full starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-x-full data-[state=open]:opacity-100 data-[state=open]:translate-x-0';
</script>

{#if isLogin || !data.auth}
    {@render children?.()}
{:else}
    <div class="flex min-h-screen flex-col">
        <AppBar class="bg-surface-100-900 border-surface-200-800 sticky top-0 z-30 border-b">
            <AppBar.Toolbar class="mx-auto w-full max-w-6xl grid-cols-[auto_1fr_auto] gap-3">
                <AppBar.Lead>
                    <a href="/dashboard" class="flex items-center gap-2 font-semibold">
                        <Layers class="size-5" />
                        <span>capgo-update-lite</span>
                    </a>
                </AppBar.Lead>
                <AppBar.Headline />
                <AppBar.Trail>
                    <ul class="hidden items-center gap-1 text-sm md:flex">
                        {#each nav as item}
                            <li>
                                <a
                                    href={item.href}
                                    class="hover:text-primary-500 px-2 py-1 {isActive(item.href, item.exact)
                                        ? 'text-primary-500 font-semibold'
                                        : ''}"
                                >
                                    {item.label}
                                </a>
                            </li>
                        {/each}
                        <li class="border-surface-200-800 ml-2 border-l pl-3">
                            <Lightswitch />
                        </li>
                        <li>
                            <form method="POST" action="/dashboard/logout">
                                <button type="submit" class="btn btn-sm preset-tonal">Log out</button>
                            </form>
                        </li>
                    </ul>
                    <Dialog open={drawerOpen} onOpenChange={(d) => (drawerOpen = d.open)}>
                        <Dialog.Trigger class="btn-icon hover:preset-tonal md:hidden" aria-label="Open menu">
                            <Menu class="size-6" />
                        </Dialog.Trigger>
                        <Portal>
                            <Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 {animBackdrop}" />
                            <Dialog.Positioner class="fixed inset-0 z-50 flex justify-end">
                                <Dialog.Content
                                    class="card bg-surface-100-900 flex h-screen w-72 flex-col gap-4 p-4 shadow-xl {animDrawer}"
                                >
                                    <header class="flex items-center justify-between">
                                        <Dialog.Title class="text-lg font-semibold">Menu</Dialog.Title>
                                        <Dialog.CloseTrigger class="btn-icon preset-tonal" aria-label="Close menu">
                                            <X class="size-5" />
                                        </Dialog.CloseTrigger>
                                    </header>
                                    <ul class="flex flex-1 flex-col gap-1 text-sm">
                                        {#each nav as item}
                                            <li>
                                                <a
                                                    href={item.href}
                                                    class="hover:bg-surface-200-800 block rounded px-3 py-2 {isActive(
                                                        item.href,
                                                        item.exact
                                                    )
                                                        ? 'bg-surface-200-800 text-primary-500 font-semibold'
                                                        : ''}"
                                                >
                                                    {item.label}
                                                </a>
                                            </li>
                                        {/each}
                                    </ul>
                                    <div class="border-surface-200-800 flex items-center justify-between border-t pt-3">
                                        <span class="text-surface-600-400 text-sm">Theme</span>
                                        <Lightswitch />
                                    </div>
                                    <form method="POST" action="/dashboard/logout">
                                        <button
                                            type="submit"
                                            class="btn preset-tonal flex w-full items-center justify-center gap-2"
                                        >
                                            <LogOut class="size-4" /> Log out
                                        </button>
                                    </form>
                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog>
                </AppBar.Trail>
            </AppBar.Toolbar>
        </AppBar>

        <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            {@render children?.()}
        </main>
    </div>
{/if}
