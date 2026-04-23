<script lang="ts">
    import { enhance } from '$app/forms';
    let { form } = $props();
    let submitting = $state(false);
</script>

<svelte:head>
    <title>Sign in — capgo-update-lite</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-6">
    <div class="card preset-filled-surface-100-900 w-full max-w-sm space-y-6 p-8">
        <div class="space-y-1">
            <h1 class="h3">capgo-update-lite</h1>
            <p class="text-surface-600-400 text-sm">Sign in with the admin token.</p>
        </div>

        <form
            method="POST"
            class="space-y-4"
            use:enhance={() => {
                submitting = true;
                return async ({ update }) => {
                    await update();
                    submitting = false;
                };
            }}
        >
            <label class="label">
                <span class="label-text">Password</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input
                    class="input"
                    type="password"
                    name="password"
                    autocomplete="current-password"
                    required
                    autofocus
                />
            </label>

            {#if form?.error}
                <div class="preset-tonal-error p-3 text-sm">{form.error}</div>
            {/if}

            <button type="submit" class="btn preset-filled-primary-500 w-full" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
            </button>
        </form>
    </div>
</div>
