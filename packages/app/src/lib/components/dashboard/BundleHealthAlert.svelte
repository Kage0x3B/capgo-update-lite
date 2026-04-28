<script lang="ts">
    import type { BundleHealthRow } from '$lib/server/services/bundleHealth.js';

    type Props = {
        row: BundleHealthRow;
        busy?: boolean;
        onReactivate?: (() => void | Promise<void>) | null;
    };
    let { row, busy = false, onReactivate = null }: Props = $props();

    const ratePct = $derived((row.failRate * 100).toFixed(row.failRate >= 0.1 ? 0 : 1));
    const isAutoDisabled = $derived(row.severity === 'auto_disabled');
    const isAtRisk = $derived(row.severity === 'at_risk');
    const preset = $derived(isAutoDisabled || isAtRisk ? 'preset-tonal-error' : 'preset-tonal-warning');
    const headline = $derived.by(() => {
        if (isAutoDisabled) return `Bundle ${row.version} was auto-disabled`;
        if (isAtRisk) return `Bundle ${row.version} is about to be auto-disabled`;
        if (row.severity === 'warning') return `Bundle ${row.version} is failing on some devices`;
        return `Bundle ${row.version}`;
    });
</script>

<div class={`card ${preset} space-y-2 p-3`}>
    <div class="flex items-start justify-between gap-3">
        <div>
            <div class="font-semibold">{headline}</div>
            <div class="text-xs opacity-80">
                {row.failedDevices} of {row.attemptedDevices} unique devices reported a bundle-integrity failure ({ratePct}%
                fail rate). Auto-disable threshold for this app:
                {(row.thresholds.disableRate * 100).toFixed(0)}% over ≥{row.thresholds.minDevices} devices.
            </div>
        </div>
        {#if isAutoDisabled && onReactivate}
            <button
                type="button"
                class="btn btn-sm preset-filled-error-500"
                disabled={busy}
                onclick={() => onReactivate?.()}
            >
                {busy ? 'Reactivating…' : 'Reactivate'}
            </button>
        {/if}
    </div>
    {#if isAutoDisabled}
        <div class="text-xs opacity-75">
            Reactivating will set the bundle active again and reset the per-device blacklist so previously failed
            devices get another shot. If the bundle is still broken, it will trip the threshold and auto-disable again.
        </div>
    {/if}
</div>
