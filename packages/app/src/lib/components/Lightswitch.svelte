<script lang="ts">
    import { Moon, Sun } from '@lucide/svelte';
    import { Switch } from '@skeletonlabs/skeleton-svelte';

    let checked = $state(false);

    $effect(() => {
        const mode = localStorage.getItem('mode') || 'dark';
        checked = mode === 'dark';
    });

    const onCheckedChange = (event: { checked: boolean }) => {
        const mode = event.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-mode', mode);
        localStorage.setItem('mode', mode);
        checked = event.checked;
    };
</script>

<svelte:head>
    <script>
        document.documentElement.setAttribute('data-mode', localStorage.getItem('mode') || 'dark');
    </script>
</svelte:head>

<div class="flex items-center gap-2">
    <Sun class="text-surface-600-400 size-4" aria-hidden="true" />
    <Switch {checked} {onCheckedChange} aria-label={checked ? 'Switch to light mode' : 'Switch to dark mode'}>
        <Switch.Control>
            <Switch.Thumb />
        </Switch.Control>
        <Switch.HiddenInput />
    </Switch>
    <Moon class="text-surface-600-400 size-4" aria-hidden="true" />
</div>
