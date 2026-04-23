<script lang="ts">
    import { page } from '$app/state';
    let { data, children } = $props();

    const nav = [
        { href: '/dashboard', label: 'Overview', exact: true },
        { href: '/dashboard/apps', label: 'Apps' },
        { href: '/dashboard/stats', label: 'Stats' },
        { href: '/dashboard/cli', label: 'CLI' }
    ];

    const isLogin = $derived(page.url.pathname === '/dashboard/login');

    function isActive(href: string, exact?: boolean): boolean {
        return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
    }
</script>

{#if isLogin || !data.admin}
    {@render children?.()}
{:else}
    <div class="flex min-h-screen flex-col">
        <header class="bg-surface-100-900 border-surface-200-800 border-b">
            <nav class="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
                <a href="/dashboard" class="font-semibold">capgo-update-lite</a>
                <ul class="flex items-center gap-4 text-sm">
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
                    <li>
                        <form method="POST" action="/dashboard/logout">
                            <button type="submit" class="btn btn-sm preset-tonal">Log out</button>
                        </form>
                    </li>
                </ul>
            </nav>
        </header>

        <main class="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
            {@render children?.()}
        </main>
    </div>
{/if}
