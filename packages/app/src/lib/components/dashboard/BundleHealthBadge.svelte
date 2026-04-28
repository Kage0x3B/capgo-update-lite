<script lang="ts">
    import type { BundleHealthSeverity } from '$lib/server/services/bundleHealth.js';

    type Props = {
        severity: BundleHealthSeverity;
        attempted: number;
        failed: number;
        rate: number;
        compact?: boolean;
    };
    let { severity, attempted, failed, rate, compact = false }: Props = $props();

    const SEVERITY_LABEL: Record<BundleHealthSeverity, string> = {
        healthy: 'Healthy',
        noisy: 'Some failures',
        warning: 'Approaching threshold',
        at_risk: 'About to auto-disable',
        auto_disabled: 'Auto-disabled',
        manually_disabled: 'Disabled'
    };

    const SEVERITY_PRESET: Record<BundleHealthSeverity, string> = {
        healthy: 'preset-tonal-success',
        noisy: 'preset-tonal-surface',
        warning: 'preset-tonal-warning',
        at_risk: 'preset-tonal-error',
        auto_disabled: 'preset-tonal-error',
        manually_disabled: 'preset-tonal-surface'
    };

    const ratePct = $derived((rate * 100).toFixed(rate >= 0.1 ? 0 : 1));
    const tooltip = $derived(`${failed}/${attempted} unique devices · ${ratePct}% fail rate`);
</script>

<span class={`badge ${SEVERITY_PRESET[severity]} whitespace-nowrap`} title={tooltip}>
    {#if !compact}
        {SEVERITY_LABEL[severity]}
        {#if attempted > 0}
            <span class="ml-1 opacity-75">{ratePct}%</span>
        {/if}
    {:else if attempted > 0}
        {ratePct}%
    {:else}
        {SEVERITY_LABEL[severity]}
    {/if}
</span>
