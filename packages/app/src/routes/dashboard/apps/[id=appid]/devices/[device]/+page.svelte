<script lang="ts">
    import { page } from '$app/state';
    import { ArrowLeft } from '@lucide/svelte';
    import { actionLabel } from '$lib/util/statsActions.js';
    import { CATEGORY_COLORS, resultInfo } from '$lib/util/updateResults.js';
    import { getDevice } from '../devices.remote';

    const appId = $derived(page.params.id ?? '');
    const deviceId = $derived(page.params.device ?? '');
    const d = $derived(await getDevice({ app_id: appId, device_id: deviceId }));

    let showEvents = $state(true);
    let hideAppState = $state(true);
    type Entry = (typeof d.timeline)[number];
    type Row = { entry: Entry; repeats: number; oldest: string };

    // Collapse runs of identical checks (same answer, versions, channel) into
    // one row: a device that keeps hearing "native app too old" shows once.
    const timeline = $derived.by(() => {
        const out: Row[] = [];
        for (const t of d.timeline) {
            if (t.kind === 'event' && (!showEvents || (hideAppState && t.action?.startsWith('app_moved_to_')))) {
                continue;
            }
            const prev = out.at(-1);
            if (prev && t.kind === 'check' && prev.entry.kind === 'check' && sameCheck(prev.entry, t)) {
                prev.repeats++;
                prev.oldest = t.at;
                continue;
            }
            out.push({ entry: t, repeats: 1, oldest: t.at });
        }
        return out;
    });

    function sameCheck(a: Extract<Entry, { kind: 'check' }>, b: Extract<Entry, { kind: 'check' }>): boolean {
        return (
            a.result === b.result &&
            a.versionName === b.versionName &&
            a.versionBuild === b.versionBuild &&
            a.channel === b.channel &&
            a.bundleVersion === b.bundleVersion &&
            a.detail === b.detail
        );
    }

    function fmt(iso: string | null): string {
        return iso ? iso.slice(0, 19).replace('T', ' ') : '—';
    }

    const facts = $derived([
        ['Platform', d.platform],
        ['OS', d.versionOs],
        ['Bundle', d.versionName],
        ['Native version', d.versionBuild],
        ['Native build code', d.versionCode],
        ['Channel', d.channel],
        ['Plugin', d.pluginVersion],
        ['Custom id', d.customId],
        ['Country', d.country],
        ['Build', d.isProd === null ? null : d.isProd ? 'release' : 'debug'],
        ['Emulator', d.isEmulator === null ? null : d.isEmulator ? 'yes' : 'no'],
        ['First seen', fmt(d.firstSeen)],
        ['Last seen', fmt(d.lastSeen)]
    ]);
</script>

<svelte:head>
    <title>{deviceId.slice(0, 8)} — {appId}</title>
</svelte:head>

<p class="mb-3 text-xs">
    <a class="anchor inline-flex items-center gap-1" href="/dashboard/apps/{appId}/devices">
        <ArrowLeft class="size-3" /> Devices
    </a>
</p>
<h2 class="h4 mb-4 font-mono break-all">{d.deviceId}</h2>

{#if d.timeline.length === 0}
    <p class="text-surface-600-400">Nothing recorded for this device.</p>
{:else}
    <section class="card preset-filled-surface-100-900 mb-6 p-3 sm:p-4">
        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {#each facts as [label, value]}
                <div class="min-w-0">
                    <dt class="text-surface-600-400 text-xs tracking-wide uppercase">{label}</dt>
                    <dd class="truncate font-mono text-xs" title={value ?? ''}>{value ?? '—'}</dd>
                </div>
            {/each}
        </dl>
    </section>

    <section>
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 class="h5">Timeline</h3>
            <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-2">
                    <input class="checkbox" type="checkbox" bind:checked={showEvents} />
                    <span>Plugin events</span>
                </label>
                <label class="flex items-center gap-2">
                    <input class="checkbox" type="checkbox" bind:checked={hideAppState} disabled={!showEvents} />
                    <span>Hide foreground/background</span>
                </label>
            </div>
        </div>
        <p class="text-surface-600-400 mb-3 text-xs">Newest first. Last 300 checks and 300 events.</p>
        <ul class="card preset-filled-surface-100-900 divide-surface-200-800 divide-y px-3 text-sm">
            {#each timeline as { entry: t, repeats, oldest } (t.id)}
                <li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                    <span class="text-surface-600-400 w-40 shrink-0 font-mono text-xs whitespace-nowrap">
                        {fmt(t.at)}
                        {#if repeats > 1}<span class="block">since {fmt(oldest)}</span>{/if}
                    </span>
                    {#if t.kind === 'check'}
                        {@const info = resultInfo(t.result)}
                        <span class="inline-flex min-w-40 items-center gap-1.5 font-medium">
                            <span
                                class="inline-block h-2 w-2 rounded-sm"
                                style:background={CATEGORY_COLORS[info.category]}
                            ></span>
                            Check: {info.label}
                            {#if repeats > 1}<span class="badge preset-tonal text-xs">×{repeats}</span>{/if}
                        </span>
                        <span class="text-surface-600-400 text-xs">
                            running <code>{t.versionName ?? '?'}</code> · native <code>{t.versionBuild ?? '?'}</code>
                            · channel <code>{t.channel ?? '?'}</code>
                            {#if t.bundleVersion}· served <code class="text-primary-500">{t.bundleVersion}</code>{/if}
                            {#if t.candidates !== null}· {t.candidates} candidate{t.candidates === 1 ? '' : 's'}{/if}
                        </span>
                        {#if t.detail && info.category !== 'current'}
                            <span class="text-surface-600-400 w-full pl-43 font-mono text-xs break-all">{t.detail}</span
                            >
                        {/if}
                    {:else}
                        <span class="min-w-40" title={t.action ?? ''}>{actionLabel(t.action)}</span>
                        <span class="text-surface-600-400 text-xs">
                            <code>{t.versionName ?? ''}</code>
                            {#if t.oldVersionName}<span> from <code>{t.oldVersionName}</code></span>{/if}
                        </span>
                    {/if}
                </li>
            {/each}
        </ul>
    </section>
{/if}
