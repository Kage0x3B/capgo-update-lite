<script lang="ts">
    import { ShieldCheck, ShieldOff } from '@lucide/svelte';
    import { createApp, getApps, getAppsWithHealth } from './apps.remote';

    const list = $derived(await getAppsWithHealth());

    let id = $state('');
    let name = $state('');
    let error = $state<string | null>(null);
    let saving = $state(false);

    async function submit(e: SubmitEvent) {
        e.preventDefault();
        error = null;
        saving = true;
        try {
            await createApp({ id: id.trim(), name: name.trim() });
            await getApps().refresh();
            await getAppsWithHealth().refresh();
            id = '';
            name = '';
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            saving = false;
        }
    }

    function fmtDate(d: Date): string {
        return d.toISOString().slice(0, 10);
    }
</script>

<svelte:head>
    <title>Apps — capgo-update-lite</title>
</svelte:head>

<header class="mb-6">
    <h1 class="h3 sm:h2">Apps</h1>
    <p class="text-surface-600-400 mt-1 text-sm">
        One row per bundle-id (e.g. <code>com.example.app</code>).
    </p>
</header>

<section class="card preset-filled-surface-100-900 mb-8 p-4 sm:p-5">
    <h2 class="h4 mb-3">Register app</h2>
    <form class="flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={submit}>
        <label class="label flex-1">
            <span class="label-text">App id</span>
            <input
                class="input"
                placeholder="com.example.app"
                bind:value={id}
                required
                pattern="^[a-z0-9]+(\.[\w-]+)+$"
            />
        </label>
        <label class="label flex-1">
            <span class="label-text">Display name</span>
            <input class="input" placeholder="Example" bind:value={name} required />
        </label>
        <button class="btn preset-filled-primary-500" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
        </button>
    </form>
    {#if error}
        <div class="preset-tonal-error mt-3 p-3 text-sm">{error}</div>
    {/if}
</section>

<section>
    {#if list.length === 0}
        <p class="text-surface-600-400">No apps yet. Register one above.</p>
    {:else}
        <!-- Mobile: card list -->
        <ul class="space-y-3 md:hidden">
            {#each list as app}
                <li class="card preset-filled-surface-100-900 space-y-2 p-3">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold">{app.name}</div>
                            <code class="text-surface-600-400 text-xs break-all">{app.id}</code>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                            {#if app.disableAutoUpdate === 'major'}
                                <span class="badge preset-tonal-warning">major</span>
                            {:else if app.disableAutoUpdate === 'minor'}
                                <span class="badge preset-tonal-error">minor</span>
                            {:else if app.disableAutoUpdate === 'patch'}
                                <span class="badge preset-tonal-error">patch</span>
                            {/if}
                            {#if app.disableAutoUpdateUnderNative}
                                <ShieldCheck
                                    class="text-success-500 size-4"
                                    aria-label="Under-native guard on"
                                />
                            {:else}
                                <ShieldOff
                                    class="text-warning-500 size-4"
                                    aria-label="Under-native guard off"
                                />
                            {/if}
                        </div>
                    </div>
                    {#if app.attention}
                        <div class="flex flex-wrap gap-1">
                            {#if app.attention.autoDisabled > 0}
                                <span class="badge preset-tonal-error">{app.attention.autoDisabled} auto-disabled</span>
                            {/if}
                            {#if app.attention.atRisk > 0}
                                <span class="badge preset-tonal-error">{app.attention.atRisk} at risk</span>
                            {/if}
                            {#if app.attention.warnings > 0}
                                <span class="badge preset-tonal-warning">{app.attention.warnings} warning</span>
                            {/if}
                            {#if app.attention.noisy > 0}
                                <span class="badge preset-tonal-surface">{app.attention.noisy} noisy</span>
                            {/if}
                        </div>
                    {/if}
                    <div class="text-surface-600-400 flex flex-wrap gap-x-3 text-xs">
                        {#if app.minPluginVersion}
                            <span>plugin ≥ <code>{app.minPluginVersion}</code></span>
                        {/if}
                        <span>created {fmtDate(app.createdAt)}</span>
                    </div>
                    <div class="border-surface-200-800 flex gap-3 border-t pt-2 text-sm">
                        <a class="anchor" href="/dashboard/apps/{app.id}">Bundles</a>
                        <a class="anchor" href="/dashboard/apps/{app.id}/stats">Stats</a>
                        <a class="anchor" href="/dashboard/apps/{app.id}/settings">Settings</a>
                    </div>
                </li>
            {/each}
        </ul>

        <!-- Desktop: table -->
        <div class="table-wrap hidden md:block">
            <table class="table">
                <thead>
                    <tr>
                        <th>App id</th>
                        <th>Name</th>
                        <th>Auto-update ceiling</th>
                        <th title="Refuses OTA bundles older than device native"> Under-native guard </th>
                        <th>Min plugin</th>
                        <th>Bundle health</th>
                        <th>Created</th>
                        <th aria-label="actions"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each list as app}
                        <tr>
                            <td><code>{app.id}</code></td>
                            <td>{app.name}</td>
                            <td>
                                {#if app.disableAutoUpdate === 'none'}
                                    <span class="text-surface-600-400">—</span>
                                {:else if app.disableAutoUpdate === 'major'}
                                    <span class="badge preset-tonal-warning">major</span>
                                {:else if app.disableAutoUpdate === 'minor'}
                                    <span class="badge preset-tonal-error">minor</span>
                                {:else}
                                    <span class="badge preset-tonal-error">patch</span>
                                {/if}
                            </td>
                            <td>
                                {#if app.disableAutoUpdateUnderNative}
                                    <ShieldCheck
                                        class="text-success-500 size-4"
                                        aria-label="On — older OTA bundles are refused"
                                    />
                                {:else}
                                    <ShieldOff
                                        class="text-warning-500 size-4"
                                        aria-label="Off — older OTA bundles can downgrade native"
                                    />
                                {/if}
                            </td>
                            <td>
                                {#if app.minPluginVersion}
                                    <code class="text-xs">{app.minPluginVersion}</code>
                                {:else}
                                    <span class="text-surface-600-400">—</span>
                                {/if}
                            </td>
                            <td>
                                {#if app.attention}
                                    <div class="flex flex-wrap gap-1">
                                        {#if app.attention.autoDisabled > 0}
                                            <span class="badge preset-tonal-error"
                                                >{app.attention.autoDisabled} auto-disabled</span
                                            >
                                        {/if}
                                        {#if app.attention.atRisk > 0}
                                            <span class="badge preset-tonal-error">{app.attention.atRisk} at risk</span>
                                        {/if}
                                        {#if app.attention.warnings > 0}
                                            <span class="badge preset-tonal-warning"
                                                >{app.attention.warnings} warning</span
                                            >
                                        {/if}
                                        {#if app.attention.noisy > 0}
                                            <span class="badge preset-tonal-surface">{app.attention.noisy} noisy</span>
                                        {/if}
                                    </div>
                                {:else}
                                    <span class="text-success-500" aria-label="Healthy">✓</span>
                                {/if}
                            </td>
                            <td class="text-surface-600-400">{fmtDate(app.createdAt)}</td>
                            <td class="space-x-3 text-right whitespace-nowrap">
                                <a class="anchor" href="/dashboard/apps/{app.id}">Bundles</a>
                                <a class="anchor" href="/dashboard/apps/{app.id}/stats">Stats</a>
                                <a class="anchor" href="/dashboard/apps/{app.id}/settings">Settings</a>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</section>
