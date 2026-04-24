<script lang="ts">
    import { untrack } from 'svelte';
    import { page } from '$app/state';
    import { getAppById, getApps, patchAppCommand } from '../../apps.remote';

    const appId = $derived(page.params.id ?? '');
    const app = $derived(await getAppById({ id: appId }));

    type Ceiling = 'none' | 'patch' | 'minor' | 'major';

    // Initial values read once via `untrack` so $state binds to the form (the
    // user is the source of truth thereafter) without warning about referencing
    // reactive state in an initializer.
    let name = $state(untrack(() => app.name));
    let disableAutoUpdate = $state<Ceiling>(untrack(() => app.disableAutoUpdate));
    let disableAutoUpdateUnderNative = $state(untrack(() => app.disableAutoUpdateUnderNative));
    let minPluginVersion = $state(untrack(() => app.minPluginVersion ?? ''));

    let saving = $state(false);
    let error = $state<string | null>(null);
    let note = $state<string | null>(null);

    const ceilingHelp: Record<Ceiling, string> = {
        none: 'No upgrade-class ceiling. Any newer bundle is eligible.',
        patch: 'Block patch, minor and major upgrades — only same-version reruns pass.',
        minor: 'Block minor and major upgrades — only patch-level bumps are served.',
        major: 'Block major upgrades only — patch and minor bumps still flow.'
    };

    async function submit(e: SubmitEvent) {
        e.preventDefault();
        error = null;
        note = null;
        saving = true;
        try {
            const trimmedPlugin = minPluginVersion.trim();
            await patchAppCommand({
                id: appId,
                patch: {
                    name: name.trim(),
                    disable_auto_update: disableAutoUpdate,
                    disable_auto_update_under_native: disableAutoUpdateUnderNative,
                    min_plugin_version: trimmedPlugin === '' ? null : trimmedPlugin
                }
            });
            await Promise.all([getAppById({ id: appId }).refresh(), getApps().refresh()]);
            note = 'Saved.';
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            saving = false;
        }
    }
</script>

<svelte:head>
    <title>{appId} — Settings</title>
</svelte:head>

<header class="mb-6">
    <p class="text-surface-600-400 text-xs">
        <a class="anchor" href="/dashboard/apps">← All apps</a>
    </p>
    <h1 class="h2"><code>{appId}</code></h1>
    <nav class="border-surface-200-800 mt-4 flex gap-5 border-b text-sm">
        <a
            href="/dashboard/apps/{appId}"
            class="text-surface-600-400 hover:text-surface-950-50 -mb-px border-b-2 border-transparent px-1 pb-2"
        >
            Bundles
        </a>
        <a
            href="/dashboard/apps/{appId}/stats"
            class="text-surface-600-400 hover:text-surface-950-50 -mb-px border-b-2 border-transparent px-1 pb-2"
        >
            Stats
        </a>
        <span class="border-primary-500 text-primary-500 -mb-px border-b-2 px-1 pb-2 font-semibold">
            Settings
        </span>
    </nav>
</header>

<section class="card preset-filled-surface-100-900 max-w-2xl p-5">
    <form class="space-y-5" onsubmit={submit}>
        <label class="label">
            <span class="label-text">Display name</span>
            <input class="input" bind:value={name} required maxlength="256" />
        </label>

        <fieldset class="space-y-2">
            <legend class="label-text">Auto-update ceiling</legend>
            <p class="text-surface-600-400 text-xs">
                Withholds bundles whose upgrade class is at or above the selected level.
            </p>
            {#each ['none', 'patch', 'minor', 'major'] as opt (opt)}
                <label class="flex items-start gap-2 text-sm">
                    <input
                        type="radio"
                        class="radio mt-1"
                        name="ceiling"
                        value={opt}
                        checked={disableAutoUpdate === opt}
                        onchange={() => (disableAutoUpdate = opt as Ceiling)}
                    />
                    <span>
                        <code>{opt}</code>
                        <span class="text-surface-600-400 ml-1">{ceilingHelp[opt as Ceiling]}</span>
                    </span>
                </label>
            {/each}
        </fieldset>

        <label class="flex items-start gap-2 text-sm">
            <input
                type="checkbox"
                class="checkbox mt-1"
                bind:checked={disableAutoUpdateUnderNative}
            />
            <span>
                <strong>Refuse OTA bundles older than device native</strong>
                <span class="text-surface-600-400 block text-xs">
                    When on, /updates withholds any bundle whose semver is lower than the device's
                    native version_build. Recommended; turning this off lets a fresh install on a
                    new native shell get downgraded by an old OTA bundle.
                </span>
            </span>
        </label>
        {#if !disableAutoUpdateUnderNative}
            <div class="preset-tonal-warning p-3 text-xs">
                Under-native guard is OFF — devices can be downgraded by older OTA bundles.
            </div>
        {/if}

        <label class="label">
            <span class="label-text">Minimum plugin version</span>
            <input
                class="input"
                bind:value={minPluginVersion}
                placeholder="6.25.0"
                maxlength="64"
            />
            <span class="text-surface-600-400 text-xs">
                Devices running an older <code>@capgo/capacitor-updater</code> are refused. Leave
                empty to clear the floor.
            </span>
        </label>

        <div class="flex items-center gap-3">
            <button class="btn preset-filled-primary-500" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
            </button>
            {#if note}<span class="text-surface-600-400 text-sm">{note}</span>{/if}
        </div>
        {#if error}
            <div class="preset-tonal-error p-3 text-sm">{error}</div>
        {/if}
    </form>
</section>
