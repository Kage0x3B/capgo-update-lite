<script lang="ts">
    import type { DashboardWindow } from '$lib/server/validation/analytics.js';

    let { value = $bindable('7d' as DashboardWindow) }: { value: DashboardWindow } = $props();

    const options: { label: string; key: DashboardWindow }[] = [
        { label: '24h', key: '24h' },
        { label: '7d', key: '7d' },
        { label: '30d', key: '30d' }
    ];
</script>

<div class="bg-surface-100-900 inline-flex rounded-lg p-1 text-sm">
    {#each options as opt}
        <button
            type="button"
            onclick={() => (value = opt.key)}
            class="rounded px-3 py-1 transition {value === opt.key
                ? 'preset-filled-primary-500'
                : 'text-surface-600-400 hover:text-surface-950-50'}"
        >
            {opt.label}
        </button>
    {/each}
</div>
