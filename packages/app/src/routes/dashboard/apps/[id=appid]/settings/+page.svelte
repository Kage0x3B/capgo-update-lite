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

    // Broken-bundle protection — empty string means "fall back to env / default".
    // We read .toString() so the inputs are always string-typed; parseRate /
    // parseInt below convert back, treating empty as null.
    let failMinDevices = $state(untrack(() => app.failMinDevices?.toString() ?? ''));
    let failWarnRate = $state(untrack(() => ratePctString(app.failWarnRate)));
    let failRiskRate = $state(untrack(() => ratePctString(app.failRiskRate)));
    let failRateThreshold = $state(untrack(() => ratePctString(app.failRateThreshold)));

    function ratePctString(r: number | null): string {
        if (r === null) return '';
        return (r * 100).toString();
    }

    function parseIntOrNull(raw: string): number | null {
        const trimmed = raw.trim();
        if (trimmed === '') return null;
        const n = Number(trimmed);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
            throw new Error(`expected non-negative integer, got "${raw}"`);
        }
        return n;
    }

    function parseRateOrNull(raw: string, label: string): number | null {
        const trimmed = raw.trim();
        if (trimmed === '') return null;
        const pct = Number(trimmed);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            throw new Error(`${label} must be between 0 and 100, got "${raw}"`);
        }
        return pct / 100;
    }

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
            const minDevices = parseIntOrNull(failMinDevices);
            const warnRate = parseRateOrNull(failWarnRate, 'Warning fail rate');
            const riskRate = parseRateOrNull(failRiskRate, 'At-risk fail rate');
            const disableRate = parseRateOrNull(failRateThreshold, 'Auto-disable fail rate');
            await patchAppCommand({
                id: appId,
                patch: {
                    name: name.trim(),
                    disable_auto_update: disableAutoUpdate,
                    disable_auto_update_under_native: disableAutoUpdateUnderNative,
                    min_plugin_version: trimmedPlugin === '' ? null : trimmedPlugin,
                    fail_min_devices: minDevices,
                    fail_warn_rate: warnRate,
                    fail_risk_rate: riskRate,
                    fail_rate_threshold: disableRate
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

    function resetThresholds() {
        failMinDevices = '';
        failWarnRate = '';
        failRiskRate = '';
        failRateThreshold = '';
    }
</script>

<svelte:head>
    <title>{appId} — Settings</title>
</svelte:head>

<section class="card preset-filled-surface-100-900 max-w-2xl p-4 sm:p-5">
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
            <input type="checkbox" class="checkbox mt-1" bind:checked={disableAutoUpdateUnderNative} />
            <span>
                <strong>Refuse OTA bundles older than device native</strong>
                <span class="text-surface-600-400 block text-xs">
                    When on, /updates withholds any bundle whose semver is lower than the device's native version_build.
                    Recommended; turning this off lets a fresh install on a new native shell get downgraded by an old
                    OTA bundle.
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
            <input class="input" bind:value={minPluginVersion} placeholder="6.25.0" maxlength="64" />
            <span class="text-surface-600-400 text-xs">
                Devices running an older <code>@capgo/capacitor-updater</code> are refused. Leave empty to clear the floor.
            </span>
        </label>

        <fieldset class="border-surface-300-700 space-y-3 rounded border p-4">
            <legend class="label-text px-1">Broken-bundle protection</legend>
            <p class="text-surface-600-400 text-xs">
                Devices that report a bundle-integrity failure (<code>set_fail</code>, <code>update_fail</code>,
                <code>decrypt_fail</code>,
                <code>checksum_fail</code>, <code>unzip_fail</code>) are individually blacklisted from receiving that
                bundle again. Once enough unique devices fail on a bundle, the dashboard shows progressively louder
                warnings and finally auto-disables it. Leave any field empty to fall back to the environment / built-in
                default.
            </p>
            <label class="label">
                <span class="label-text">Min unique devices (noise floor)</span>
                <input
                    class="input"
                    type="number"
                    min="0"
                    step="1"
                    bind:value={failMinDevices}
                    placeholder="Default: 10"
                />
                <span class="text-surface-600-400 text-xs">
                    Bundle must have been tried by at least this many unique devices before any rate-based severity
                    (warning / at risk / auto-disable) kicks in. 0 disables auto-disable for this app.
                </span>
            </label>
            <div class="grid gap-3 sm:grid-cols-3">
                <label class="label">
                    <span class="label-text">Warning rate (%)</span>
                    <input
                        class="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        bind:value={failWarnRate}
                        placeholder="Default: 20"
                    />
                </label>
                <label class="label">
                    <span class="label-text">At-risk rate (%)</span>
                    <input
                        class="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        bind:value={failRiskRate}
                        placeholder="Default: 35"
                    />
                </label>
                <label class="label">
                    <span class="label-text">Auto-disable rate (%)</span>
                    <input
                        class="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        bind:value={failRateThreshold}
                        placeholder="Default: 50"
                    />
                </label>
            </div>
            <p class="text-surface-600-400 text-xs">Order is enforced server-side: warning ≤ at-risk ≤ auto-disable.</p>
            <button type="button" class="btn btn-sm preset-tonal" onclick={resetThresholds}>
                Reset all to default
            </button>
        </fieldset>

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
