<script lang="ts">
    import { Copy, KeyRound, Plus, ShieldAlert, ShieldCheck, Trash2 } from '@lucide/svelte';
    import type { AdminRole } from '$lib/server/roles';
    import { createTokenCommand, getTokens, revokeTokenCommand } from './tokens.remote';

    type CreatedTokenView = {
        plaintext: string;
        name: string;
        role: AdminRole;
    };

    const tokens = $derived(await getTokens());

    let name = $state('');
    let role = $state<AdminRole>('publisher');
    let creating = $state(false);
    let createError = $state<string | null>(null);
    let lastCreated = $state<CreatedTokenView | null>(null);
    let copied = $state(false);

    let revokingId = $state<number | null>(null);
    let revokeError = $state<string | null>(null);

    const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
        viewer: 'Read-only dashboard + GET admin endpoints. No mutations.',
        publisher: 'Viewer + bundle CRUD: publish, edit, delete, promote, reactivate.',
        admin: 'Full access: app CRUD, per-app policy, token management.'
    };

    async function submitCreate(e: SubmitEvent) {
        e.preventDefault();
        if (!name.trim()) return;
        createError = null;
        creating = true;
        copied = false;
        try {
            const result = await createTokenCommand({ name: name.trim(), role });
            lastCreated = { plaintext: result.plaintext, name: result.summary.name, role: result.summary.role };
            name = '';
            role = 'publisher';
            await getTokens().refresh();
        } catch (e) {
            createError = e instanceof Error ? e.message : String(e);
        } finally {
            creating = false;
        }
    }

    async function copyPlaintext() {
        if (!lastCreated) return;
        try {
            await navigator.clipboard.writeText(lastCreated.plaintext);
            copied = true;
            setTimeout(() => (copied = false), 1500);
        } catch {
            /* ignore — older browsers without clipboard API */
        }
    }

    async function dismissCreated() {
        lastCreated = null;
        copied = false;
    }

    async function revoke(id: number, tokenName: string) {
        // Confirm here rather than via window.confirm so the action stays
        // styled with the rest of the dashboard. Soft-revoke is reversible
        // only by minting a new token, so a confirmation is justified.
        if (!confirm(`Revoke token "${tokenName}"? This cannot be undone.`)) return;
        revokeError = null;
        revokingId = id;
        try {
            await revokeTokenCommand({ id: String(id) });
            await getTokens().refresh();
        } catch (e) {
            revokeError = e instanceof Error ? e.message : String(e);
        } finally {
            revokingId = null;
        }
    }

    function fmtDate(d: Date | null): string {
        if (!d) return '—';
        return new Date(d).toISOString().slice(0, 16).replace('T', ' ');
    }

    function roleBadgeClass(r: AdminRole): string {
        if (r === 'admin') return 'badge preset-tonal-error';
        if (r === 'publisher') return 'badge preset-tonal-warning';
        return 'badge preset-tonal-surface';
    }
</script>

<svelte:head>
    <title>Admin tokens — capgo-update-lite</title>
</svelte:head>

<header class="mb-6">
    <h1 class="h3 sm:h2 flex items-center gap-2">
        <KeyRound class="size-6" />
        Admin tokens
    </h1>
    <p class="text-surface-600-400 mt-1 text-sm">
        Issue scoped tokens for CI pipelines, ops, and the dashboard. The build-time
        <code>PRIVATE_ADMIN_TOKEN</code>
        always works as super-admin and bypasses this list.
    </p>
</header>

{#if lastCreated}
    <section class="card preset-tonal-success mb-6 p-4">
        <h2 class="h4 mb-2 flex items-center gap-2">
            <ShieldCheck class="size-5" />
            Token "{lastCreated.name}" created
        </h2>
        <p class="text-surface-700-300 mb-3 text-sm">
            Save this token now — it cannot be retrieved later. Granted role:
            <span class={roleBadgeClass(lastCreated.role)}>{lastCreated.role}</span>
        </p>
        <div class="flex items-center gap-2">
            <input class="input font-mono text-xs" readonly value={lastCreated.plaintext} />
            <button class="btn preset-filled-primary-500 shrink-0" type="button" onclick={copyPlaintext}>
                <Copy class="size-4" />
                {copied ? 'Copied' : 'Copy'}
            </button>
            <button class="btn preset-tonal-surface shrink-0" type="button" onclick={dismissCreated}>
                I've saved it
            </button>
        </div>
    </section>
{/if}

<section class="card preset-filled-surface-100-900 mb-8 p-4 sm:p-5">
    <h2 class="h4 mb-3 flex items-center gap-2">
        <Plus class="size-5" />
        New token
    </h2>
    <form class="flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={submitCreate}>
        <label class="label flex-1">
            <span class="label-text">Name</span>
            <input class="input" placeholder="CI publish" bind:value={name} required maxlength="100" />
        </label>
        <label class="label sm:w-48">
            <span class="label-text">Role</span>
            <select class="select" bind:value={role}>
                <option value="viewer">viewer</option>
                <option value="publisher">publisher</option>
                <option value="admin">admin</option>
            </select>
        </label>
        <button class="btn preset-filled-primary-500" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create token'}
        </button>
    </form>
    <p class="text-surface-600-400 mt-3 text-xs">{ROLE_DESCRIPTIONS[role]}</p>
    {#if createError}
        <div class="preset-tonal-error mt-3 p-3 text-sm">{createError}</div>
    {/if}
</section>

<section>
    <h2 class="h4 mb-3">Existing tokens</h2>
    {#if revokeError}
        <div class="preset-tonal-error mb-3 p-3 text-sm">{revokeError}</div>
    {/if}
    {#if tokens.length === 0}
        <p class="text-surface-600-400">No tokens yet.</p>
    {:else}
        <div class="overflow-x-auto">
            <table class="table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Created</th>
                        <th>Last used</th>
                        <th>Status</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {#each tokens as t (t.id)}
                        <tr class:opacity-50={t.revoked}>
                            <td class="font-medium">{t.name}</td>
                            <td><span class={roleBadgeClass(t.role)}>{t.role}</span></td>
                            <td class="text-surface-600-400 text-sm">{fmtDate(t.createdAt)}</td>
                            <td class="text-surface-600-400 text-sm">{fmtDate(t.lastUsedAt)}</td>
                            <td>
                                {#if t.revoked}
                                    <span class="badge preset-tonal-error inline-flex items-center gap-1">
                                        <ShieldAlert class="size-3" /> revoked
                                    </span>
                                {:else}
                                    <span class="badge preset-tonal-success">active</span>
                                {/if}
                            </td>
                            <td class="text-right">
                                {#if !t.revoked}
                                    <button
                                        class="btn preset-tonal-error btn-sm"
                                        type="button"
                                        disabled={revokingId === t.id}
                                        onclick={() => revoke(t.id, t.name)}
                                    >
                                        <Trash2 class="size-3" />
                                        {revokingId === t.id ? 'Revoking…' : 'Revoke'}
                                    </button>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</section>
