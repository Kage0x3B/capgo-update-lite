<script lang="ts">
    import type { AppNeedingAttention } from '$lib/server/services/bundleHealth.js';

    type Props = { rows: AppNeedingAttention[] };
    let { rows }: Props = $props();

    const totals = $derived.by(() => {
        let autoDisabled = 0;
        let atRisk = 0;
        let warnings = 0;
        for (const r of rows) {
            autoDisabled += r.autoDisabled;
            atRisk += r.atRisk;
            warnings += r.warnings;
        }
        return { autoDisabled, atRisk, warnings };
    });
    const severePreset = $derived(
        totals.autoDisabled > 0 || totals.atRisk > 0 ? 'preset-tonal-error' : 'preset-tonal-warning'
    );
    const headline = $derived.by(() => {
        const parts: string[] = [];
        if (totals.autoDisabled > 0) parts.push(`${totals.autoDisabled} auto-disabled`);
        if (totals.atRisk > 0) parts.push(`${totals.atRisk} about to auto-disable`);
        if (totals.warnings > 0) parts.push(`${totals.warnings} approaching threshold`);
        return parts.length > 0 ? `Bundle health · ${parts.join(', ')}` : 'Bundle health';
    });
</script>

{#if rows.length > 0}
    <div class={`card ${severePreset} space-y-2 p-3`}>
        <div class="font-semibold">{headline}</div>
        <ul class="space-y-1 text-sm">
            {#each rows as row}
                <li class="flex flex-wrap items-center gap-2">
                    <a class="anchor" href="/dashboard/apps/{row.appId}">{row.appName}</a>
                    <code class="text-xs opacity-75">{row.appId}</code>
                    {#if row.autoDisabled > 0}
                        <span class="badge preset-tonal-error">{row.autoDisabled} auto-disabled</span>
                    {/if}
                    {#if row.atRisk > 0}
                        <span class="badge preset-tonal-error">{row.atRisk} at risk</span>
                    {/if}
                    {#if row.warnings > 0}
                        <span class="badge preset-tonal-warning">{row.warnings} warning</span>
                    {/if}
                    {#if row.noisy > 0}
                        <span class="badge preset-tonal-surface">{row.noisy} noisy</span>
                    {/if}
                </li>
            {/each}
        </ul>
    </div>
{/if}
