<script lang="ts">
    import { createApp, getApps } from './apps.remote';

    const list = $derived(await getApps());

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
    <h1 class="h2">Apps</h1>
    <p class="text-surface-600-400 mt-1 text-sm">
        One row per bundle-id (e.g. <code>com.example.app</code>).
    </p>
</header>

<section class="card preset-filled-surface-100-900 mb-8 p-5">
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
        <div class="table-wrap">
            <table class="table">
                <thead>
                    <tr>
                        <th>App id</th>
                        <th>Name</th>
                        <th>Auto-update ceiling</th>
                        <th title="Refuses OTA bundles older than device native">
                            Under-native guard
                        </th>
                        <th>Min plugin</th>
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
                                    <span title="On — older OTA bundles are refused">🛡️</span>
                                {:else}
                                    <span title="Off — older OTA bundles can downgrade native"
                                        >⚠️</span
                                    >
                                {/if}
                            </td>
                            <td>
                                {#if app.minPluginVersion}
                                    <code class="text-xs">{app.minPluginVersion}</code>
                                {:else}
                                    <span class="text-surface-600-400">—</span>
                                {/if}
                            </td>
                            <td class="text-surface-600-400">{fmtDate(app.createdAt)}</td>
                            <td class="space-x-3 text-right whitespace-nowrap">
                                <a class="anchor" href="/dashboard/apps/{app.id}">Bundles</a>
                                <a class="anchor" href="/dashboard/apps/{app.id}/stats">Stats</a>
                                <a class="anchor" href="/dashboard/apps/{app.id}/settings"
                                    >Settings</a
                                >
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</section>
