<script lang="ts">
    import { page } from '$app/state';
    import BundleHealthAlert from '$lib/components/dashboard/BundleHealthAlert.svelte';
    import BundleHealthBadge from '$lib/components/dashboard/BundleHealthBadge.svelte';
    import { zipFiles } from '$lib/util/zip.js';
    import {
        commitBundle,
        deleteBundle,
        getBundleHealth,
        getBundles,
        initBundle,
        patchBundle,
        reactivateBundle
    } from './bundles.remote';

    const appId = $derived(page.params.id ?? '');
    const list = $derived(await getBundles({ app_id: appId }));
    const health = $derived(await getBundleHealth({ app_id: appId }));
    const healthByBundle = $derived(new Map(health.map((h) => [h.bundleId, h])));

    type Phase = 'idle' | 'zipping' | 'reserving' | 'uploading' | 'committing';

    let version = $state('');
    let channel = $state('production');
    let minAndroidBuild = $state('');
    let minIosBuild = $state('');
    let activateOnCommit = $state(false);
    let files = $state<FileList | null>(null);
    let phase = $state<Phase>('idle');
    let uploadError = $state<string | null>(null);
    let uploadNote = $state<string | null>(null);

    let rowBusy = $state<Record<number, boolean>>({});
    let confirmingPurge = $state<number | null>(null);
    let expandedNative = $state<Record<number, boolean>>({});

    async function submitUpload(e: SubmitEvent) {
        e.preventDefault();
        uploadError = null;
        uploadNote = null;
        if (!files || files.length === 0) {
            uploadError = 'pick a folder first';
            return;
        }
        try {
            phase = 'zipping';
            const { blob, sha256, size } = await zipFiles(Array.from(files));
            uploadNote = `zipped ${Math.round(size / 1024)} KB (sha256 ${sha256.slice(0, 12)}…)`;

            phase = 'reserving';
            // Default min builds to the bundle version when the operator leaves
            // the fields blank — matches the common case of bumping native and
            // OTA together. Native-package fingerprinting only runs through the
            // CLI, so dashboard uploads always send an empty fingerprint.
            const trimmedVersion = version.trim();
            const init = await initBundle({
                app_id: appId,
                version: trimmedVersion,
                channel: channel.trim() || undefined,
                min_android_build: minAndroidBuild.trim() || trimmedVersion,
                min_ios_build: minIosBuild.trim() || trimmedVersion,
                native_packages: {}
            });

            phase = 'uploading';
            const putRes = await fetch(init.upload_url, {
                method: 'PUT',
                body: blob,
                headers: { 'content-type': 'application/zip' }
            });
            if (!putRes.ok) {
                const body = await putRes.text().catch(() => '');
                throw new Error(`R2 PUT failed: ${putRes.status} ${body.slice(0, 200)}`);
            }

            phase = 'committing';
            await commitBundle({
                bundle_id: init.bundle_id,
                checksum: sha256,
                activate: activateOnCommit
            });
            await getBundles({ app_id: appId }).refresh();

            uploadNote = `published bundle ${init.bundle_id} (${version.trim()})`;
            version = '';
            minAndroidBuild = '';
            minIosBuild = '';
            files = null;
            activateOnCommit = false;
        } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
        } finally {
            phase = 'idle';
        }
    }

    async function toggleActive(id: number, active: boolean) {
        rowBusy[id] = true;
        try {
            await patchBundle({ id, patch: { active } });
            await Promise.all([getBundles({ app_id: appId }).refresh(), getBundleHealth({ app_id: appId }).refresh()]);
        } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
        } finally {
            rowBusy[id] = false;
        }
    }

    async function reactivate(id: number) {
        rowBusy[id] = true;
        try {
            await reactivateBundle({ id });
            await Promise.all([getBundles({ app_id: appId }).refresh(), getBundleHealth({ app_id: appId }).refresh()]);
        } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
        } finally {
            rowBusy[id] = false;
        }
    }

    async function softDelete(id: number) {
        rowBusy[id] = true;
        try {
            await deleteBundle({ id });
            await getBundles({ app_id: appId }).refresh();
        } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
        } finally {
            rowBusy[id] = false;
        }
    }

    async function purge(id: number) {
        rowBusy[id] = true;
        confirmingPurge = null;
        try {
            await deleteBundle({ id, purge: true });
            await getBundles({ app_id: appId }).refresh();
        } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
        } finally {
            rowBusy[id] = false;
        }
    }

    function fmtDate(d: Date | null): string {
        if (!d) return '—';
        return d.toISOString().slice(0, 19).replace('T', ' ');
    }

    const phaseLabel: Record<Phase, string> = {
        idle: 'Upload',
        zipping: 'Zipping…',
        reserving: 'Reserving slot…',
        uploading: 'Uploading to R2…',
        committing: 'Committing…'
    };
</script>

<svelte:head>
    <title>{appId} — Bundles</title>
</svelte:head>

<section class="card preset-filled-surface-100-900 mb-8 p-4 sm:p-5">
    <h2 class="h4 mb-3">Upload bundle</h2>
    <form class="space-y-3" onsubmit={submitUpload}>
        <div class="grid gap-3 sm:grid-cols-3">
            <label class="label">
                <span class="label-text">Version</span>
                <input class="input" bind:value={version} placeholder="1.1.0" required />
            </label>
            <label class="label">
                <span class="label-text">Channel</span>
                <input class="input" bind:value={channel} placeholder="production" />
            </label>
            <label class="label">
                <span class="label-text">Dist folder</span>
                <input
                    class="input"
                    type="file"
                    onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)}
                    {...{ webkitdirectory: '', directory: '' } as Record<string, string>}
                    required
                />
            </label>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
            <label class="label">
                <span class="label-text" title="Android versionName floor — devices with an older native are refused"
                    >Min Android version</span
                >
                <input class="input" bind:value={minAndroidBuild} placeholder="defaults to bundle version" />
            </label>
            <label class="label">
                <span class="label-text" title="iOS CFBundleShortVersionString floor">Min iOS version</span>
                <input class="input" bind:value={minIosBuild} placeholder="defaults to bundle version" />
            </label>
        </div>
        <label class="flex items-center gap-2 text-sm">
            <input class="checkbox" type="checkbox" bind:checked={activateOnCommit} />
            <span>Activate on commit (atomically deactivates any current active bundle in this channel)</span>
        </label>
        <div class="flex items-center gap-3">
            <button class="btn preset-filled-primary-500" type="submit" disabled={phase !== 'idle'}>
                {phaseLabel[phase]}
            </button>
            {#if uploadNote}<span class="text-surface-600-400 text-sm">{uploadNote}</span>{/if}
        </div>
        {#if uploadError}
            <div class="preset-tonal-error p-3 text-sm">{uploadError}</div>
        {/if}
    </form>
</section>

<section>
    <h2 class="h4 mb-3">Bundles</h2>
    {#if list.length === 0}
        <p class="text-surface-600-400">No bundles yet. Upload one above.</p>
    {:else}
        <!-- Mobile: card list -->
        <ul class="space-y-3 md:hidden">
            {#each list as b}
                {@const nativeCount = Object.keys(b.nativePackages).length}
                {@const hRow = healthByBundle.get(b.id)}
                {@const showAlert = hRow && (hRow.severity === 'auto_disabled' || hRow.severity === 'at_risk')}
                <li class="card preset-filled-surface-100-900 space-y-2 p-3">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <code class="font-semibold break-all">{b.version}</code>
                        <div class="flex shrink-0 items-center gap-2">
                            {#if b.state === 'active'}
                                <span class="badge preset-tonal-success">active</span>
                            {:else if b.state === 'pending'}
                                <span class="badge preset-tonal-warning">pending</span>
                            {:else}
                                <span class="badge preset-tonal-error">{b.state}</span>
                            {/if}
                            {#if hRow}
                                <BundleHealthBadge
                                    severity={hRow.severity}
                                    attempted={hRow.attemptedDevices}
                                    failed={hRow.failedDevices}
                                    rate={hRow.failRate}
                                />
                            {/if}
                        </div>
                    </div>
                    <dl class="text-surface-600-400 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                        <div>
                            <dt class="inline">id</dt>
                            <dd class="inline">{b.id}</dd>
                        </div>
                        <div>
                            <dt class="inline">channel</dt>
                            <dd class="inline">{b.channel}</dd>
                        </div>
                        <div>
                            <dt class="inline">android ≥</dt>
                            <dd class="inline"><code>{b.minAndroidBuild}</code></dd>
                        </div>
                        <div>
                            <dt class="inline">ios ≥</dt>
                            <dd class="inline"><code>{b.minIosBuild}</code></dd>
                        </div>
                        {#if b.platforms.length > 0}
                            <div class="col-span-2">
                                <dt class="inline">platforms</dt>
                                <dd class="inline">{b.platforms.join(', ')}</dd>
                            </div>
                        {/if}
                        {#if b.releasedAt}
                            <div class="col-span-2">
                                <dt class="inline">released</dt>
                                <dd class="inline">{fmtDate(b.releasedAt)}</dd>
                            </div>
                        {/if}
                    </dl>
                    {#if showAlert && hRow}
                        <BundleHealthAlert
                            row={hRow}
                            busy={rowBusy[b.id]}
                            onReactivate={hRow.severity === 'auto_disabled' ? () => reactivate(b.id) : null}
                        />
                    {/if}
                    <div class="border-surface-200-800 flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                        {#if b.state === 'active'}
                            <label class="flex items-center gap-2 text-xs">
                                <input
                                    class="switch"
                                    type="checkbox"
                                    checked={b.active}
                                    disabled={rowBusy[b.id]}
                                    onchange={(e) => toggleActive(b.id, (e.currentTarget as HTMLInputElement).checked)}
                                />
                                <span>{b.active ? 'Live' : 'Paused'}</span>
                            </label>
                        {/if}
                        {#if nativeCount > 0}
                            <button
                                class="badge preset-tonal"
                                onclick={() => (expandedNative[b.id] = !expandedNative[b.id])}
                            >
                                {nativeCount} native deps
                            </button>
                        {/if}
                        <div class="ml-auto flex gap-2">
                            {#if b.state !== 'failed'}
                                <button
                                    class="btn btn-sm preset-tonal"
                                    disabled={rowBusy[b.id]}
                                    onclick={() => softDelete(b.id)}
                                >
                                    Disable
                                </button>
                            {/if}
                            {#if confirmingPurge === b.id}
                                <button
                                    class="btn btn-sm preset-filled-error-500"
                                    disabled={rowBusy[b.id]}
                                    onclick={() => purge(b.id)}
                                >
                                    Really purge?
                                </button>
                                <button class="btn btn-sm preset-tonal" onclick={() => (confirmingPurge = null)}>
                                    Cancel
                                </button>
                            {:else}
                                <button
                                    class="btn btn-sm preset-tonal-error"
                                    disabled={rowBusy[b.id]}
                                    onclick={() => (confirmingPurge = b.id)}
                                >
                                    Purge
                                </button>
                            {/if}
                        </div>
                    </div>
                    {#if expandedNative[b.id] && nativeCount > 0}
                        <div class="bg-surface-50-950 -mx-3 mt-2 -mb-3 rounded-b px-3 py-2 text-xs">
                            <p class="text-surface-600-400 mb-2">Native-dep fingerprint captured at publish time.</p>
                            <ul class="divide-surface-200-800 divide-y">
                                {#each Object.entries(b.nativePackages).sort( ([a], [c]) => a.localeCompare(c) ) as [pkg, ver] (pkg)}
                                    <li class="flex items-baseline justify-between gap-3 py-1">
                                        <code class="min-w-0 truncate">{pkg}</code>
                                        <code class="shrink-0">{ver}</code>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>

        <!-- Desktop: table -->
        <div class="table-wrap hidden md:block">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Version</th>
                        <th>Min Android</th>
                        <th>Min iOS</th>
                        <th>Channel</th>
                        <th>Platforms</th>
                        <th>State</th>
                        <th>Health</th>
                        <th>Active</th>
                        <th>Released</th>
                        <th aria-label="actions"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each list as b}
                        {@const nativeCount = Object.keys(b.nativePackages).length}
                        {@const hRow = healthByBundle.get(b.id)}
                        {@const showAlert = hRow && (hRow.severity === 'auto_disabled' || hRow.severity === 'at_risk')}
                        <tr>
                            <td class="text-surface-600-400">{b.id}</td>
                            <td><code>{b.version}</code></td>
                            <td><code class="text-xs">{b.minAndroidBuild}</code></td>
                            <td><code class="text-xs">{b.minIosBuild}</code></td>
                            <td>{b.channel}</td>
                            <td class="text-xs">{b.platforms.join(', ')}</td>
                            <td>
                                {#if b.state === 'active'}
                                    <span class="badge preset-tonal-success">active</span>
                                {:else if b.state === 'pending'}
                                    <span class="badge preset-tonal-warning">pending</span>
                                {:else}
                                    <span class="badge preset-tonal-error">{b.state}</span>
                                {/if}
                            </td>
                            <td>
                                {#if hRow}
                                    <BundleHealthBadge
                                        severity={hRow.severity}
                                        attempted={hRow.attemptedDevices}
                                        failed={hRow.failedDevices}
                                        rate={hRow.failRate}
                                    />
                                {:else}
                                    <span class="text-surface-600-400">—</span>
                                {/if}
                            </td>
                            <td>
                                {#if b.state === 'active'}
                                    <label class="switch">
                                        <input
                                            type="checkbox"
                                            checked={b.active}
                                            disabled={rowBusy[b.id]}
                                            onchange={(e) =>
                                                toggleActive(b.id, (e.currentTarget as HTMLInputElement).checked)}
                                        />
                                    </label>
                                {:else}
                                    —
                                {/if}
                            </td>
                            <td class="text-surface-600-400 text-xs">{fmtDate(b.releasedAt)}</td>
                            <td class="space-x-2 text-right whitespace-nowrap">
                                {#if nativeCount > 0}
                                    <button
                                        class="badge preset-tonal"
                                        title="Toggle native-package fingerprint"
                                        onclick={() => (expandedNative[b.id] = !expandedNative[b.id])}
                                    >
                                        {nativeCount} native deps
                                    </button>
                                {/if}
                                {#if b.state !== 'failed'}
                                    <button
                                        class="btn btn-sm preset-tonal"
                                        disabled={rowBusy[b.id]}
                                        onclick={() => softDelete(b.id)}
                                    >
                                        Disable
                                    </button>
                                {/if}
                                {#if confirmingPurge === b.id}
                                    <button
                                        class="btn btn-sm preset-filled-error-500"
                                        disabled={rowBusy[b.id]}
                                        onclick={() => purge(b.id)}
                                    >
                                        Really purge?
                                    </button>
                                    <button class="btn btn-sm preset-tonal" onclick={() => (confirmingPurge = null)}>
                                        Cancel
                                    </button>
                                {:else}
                                    <button
                                        class="btn btn-sm preset-tonal-error"
                                        disabled={rowBusy[b.id]}
                                        onclick={() => (confirmingPurge = b.id)}
                                    >
                                        Purge
                                    </button>
                                {/if}
                            </td>
                        </tr>
                        {#if showAlert && hRow}
                            <tr>
                                <td colspan="11" class="!p-2">
                                    <BundleHealthAlert
                                        row={hRow}
                                        busy={rowBusy[b.id]}
                                        onReactivate={hRow.severity === 'auto_disabled' ? () => reactivate(b.id) : null}
                                    />
                                </td>
                            </tr>
                        {/if}
                        {#if expandedNative[b.id] && nativeCount > 0}
                            <tr class="bg-surface-50-950">
                                <td colspan="11">
                                    <div class="px-3 py-2">
                                        <p class="text-surface-600-400 mb-2 text-xs">
                                            Native-dep fingerprint captured at publish time. Drives the CLI's <code
                                                >--auto-min-update-build</code
                                            >
                                            decision.
                                        </p>
                                        <table class="table-compact table text-xs">
                                            <thead>
                                                <tr>
                                                    <th>Package</th>
                                                    <th>Version</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {#each Object.entries(b.nativePackages).sort( ([a], [c]) => a.localeCompare(c) ) as [pkg, ver] (pkg)}
                                                    <tr>
                                                        <td><code>{pkg}</code></td>
                                                        <td><code>{ver}</code></td>
                                                    </tr>
                                                {/each}
                                            </tbody>
                                        </table>
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</section>
