<script lang="ts">
    import { Copy, ExternalLink, X } from '@lucide/svelte';
    import { actionGroup, actionLabel } from '$lib/util/statsActions.js';
    import { CATEGORY_COLORS, resultInfo } from '$lib/util/updateResults.js';
    import { getExplorerRow } from '$lib/remote/explorer.remote.js';
    import { withValue, type ExplorerQuery, type ExplorerRow } from '$lib/util/explorer.js';
    import { ago, localStamp, utcStamp } from '$lib/util/time.js';
    import { clock } from '$lib/util/clock.svelte.js';

    let {
        kind,
        id,
        q,
        onchange,
        onclose,
        onselect
    }: {
        kind: 'event' | 'check';
        id: string;
        q: ExplorerQuery;
        onchange: (next: ExplorerQuery) => void;
        onclose: () => void;
        onselect: (row: ExplorerRow) => void;
    } = $props();

    const ctx = $derived(await getExplorerRow({ kind, id }));
    const r = $derived(ctx.row);

    let copied = $state('');
    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            copied = text;
            setTimeout(() => (copied = ''), 1200);
        } catch {
            /* clipboard blocked */
        }
    }

    const facts = $derived.by((): [string, string | null][] => {
        if (!r) return [];
        return [
            ['App', r.appId],
            ['Custom id', r.customId],
            ['Platform', r.platform],
            ['OS', r.versionOs],
            ['Bundle', r.versionName],
            ...(r.kind === 'event'
                ? ([['Previous bundle', r.oldVersionName || null]] as [string, string | null][])
                : []),
            ...(r.kind === 'check'
                ? ([
                      ['Served bundle', r.bundleVersion],
                      ['Candidates', r.candidates === null ? null : String(r.candidates)]
                  ] as [string, string | null][])
                : []),
            ['Native version', r.versionBuild],
            ['Native build code', r.versionCode],
            ['Channel', r.channel],
            ['Plugin', r.pluginVersion],
            ['Country', r.country],
            ['Build', r.isProd === null ? null : r.isProd ? 'release' : 'debug'],
            ['Emulator', r.isEmulator === null ? null : r.isEmulator ? 'yes' : 'no']
        ];
    });

    function label(x: ExplorerRow) {
        return x.kind === 'check' ? `Check: ${resultInfo(x.result ?? '').label}` : actionLabel(x.action);
    }
    function color(x: ExplorerRow) {
        return x.kind === 'check'
            ? CATEGORY_COLORS[resultInfo(x.result ?? '').category]
            : (actionGroup(x.action)?.color ?? 'var(--color-surface-500)');
    }
    function offset(x: ExplorerRow): string {
        if (!r) return '';
        const s = Math.round((new Date(x.at).getTime() - new Date(r.at).getTime()) / 1000);
        if (s === 0) return '±0s';
        const sign = s > 0 ? '+' : '−';
        const a = Math.abs(s);
        return a < 60 ? `${sign}${a}s` : `${sign}${Math.floor(a / 60)}m${a % 60 ? ` ${a % 60}s` : ''}`;
    }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex justify-end">
    <button
        type="button"
        class="bg-surface-50-950/50 absolute inset-0 cursor-default"
        aria-label="Close details"
        onclick={onclose}
    ></button>
    <aside
        class="bg-surface-100-900 border-surface-200-800 relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l shadow-2xl"
        aria-label="Row details"
    >
        <header
            class="border-surface-200-800 bg-surface-100-900 sticky top-0 z-10 flex items-start justify-between gap-3 border-b p-4"
        >
            {#if r}
                <div class="min-w-0">
                    <div class="flex items-center gap-2 text-lg font-semibold">
                        <span class="inline-block size-2.5 rounded-full" style:background={color(r)}></span>
                        {label(r)}
                    </div>
                    <div class="text-surface-600-400 mt-0.5 font-mono text-xs">
                        {localStamp(r.at, true)} · {utcStamp(r.at)} UTC{clock.ready ? ` · ${ago(r.at, clock.now)}` : ''}
                    </div>
                    <div class="text-surface-600-400 font-mono text-[11px]">
                        {r.kind} #{r.id} · {r.kind === 'event' ? r.action : r.result}
                    </div>
                </div>
            {:else}
                <div class="text-surface-600-400">Row not found (pruned?)</div>
            {/if}
            <button type="button" class="btn-icon hover:preset-tonal" aria-label="Close" onclick={onclose}
                ><X class="size-5" /></button
            >
        </header>

        {#if r}
            <section class="space-y-4 p-4">
                <div class="card preset-filled-surface-50-950 space-y-2 p-3">
                    <div class="text-surface-600-400 text-xs tracking-wide uppercase">Device</div>
                    <div class="flex items-center gap-2">
                        <code class="min-w-0 flex-1 text-xs break-all">{r.deviceId}</code>
                        <button type="button" class="btn btn-sm preset-tonal" onclick={() => copy(r.deviceId)}>
                            <Copy class="size-3.5" />{copied === r.deviceId ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button
                            type="button"
                            class="btn btn-sm preset-tonal"
                            onclick={() => {
                                onchange(withValue(q, 'device', r.deviceId, 'only'));
                                onclose();
                            }}>Only this device</button
                        >
                        <a class="btn btn-sm preset-tonal" href="/dashboard/apps/{r.appId}/devices/{r.deviceId}">
                            Device page <ExternalLink class="size-3.5" />
                        </a>
                    </div>
                </div>

                {#if r.detail}
                    <div class="card preset-tonal-warning p-3">
                        <div class="mb-1 text-xs tracking-wide uppercase">Server detail</div>
                        <code class="text-xs break-all">{r.detail}</code>
                        {#if resultInfo(r.result ?? '').hint}
                            <p class="mt-2 text-xs">{resultInfo(r.result ?? '').hint}</p>
                        {/if}
                    </div>
                {/if}

                <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {#each facts as [k, v]}
                        <div class="min-w-0">
                            <dt class="text-surface-600-400 text-[11px] tracking-wide uppercase">{k}</dt>
                            <dd class="truncate font-mono text-xs" title={v ?? ''}>{v ?? '—'}</dd>
                        </div>
                    {/each}
                </dl>

                <div>
                    <h3 class="text-surface-600-400 mb-2 text-xs tracking-wide uppercase">Same device, ±30 min</h3>
                    <ol class="border-surface-200-800 divide-surface-200-800 divide-y rounded border text-xs">
                        {#each ctx.around as x (x.kind + x.id)}
                            {@const me = x.kind === r.kind && x.id === r.id}
                            <li>
                                <button
                                    type="button"
                                    class="flex w-full items-center gap-2 px-2 py-1.5 text-left {me
                                        ? 'bg-primary-500/15 font-semibold'
                                        : 'hover:bg-surface-200-800'}"
                                    onclick={() => onselect(x)}
                                >
                                    <span class="text-surface-600-400 w-16 shrink-0 text-right font-mono tabular-nums"
                                        >{offset(x)}</span
                                    >
                                    <span class="inline-block size-2 shrink-0 rounded-full" style:background={color(x)}
                                    ></span>
                                    <span class="min-w-0 flex-1 truncate">{label(x)}</span>
                                    <code class="text-surface-600-400 shrink-0"
                                        >{x.bundleVersion ?? x.versionName ?? ''}</code
                                    >
                                </button>
                            </li>
                        {/each}
                    </ol>
                </div>
            </section>
        {/if}
    </aside>
</div>
