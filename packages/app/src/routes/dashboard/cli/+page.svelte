<script lang="ts">
    import { page } from '$app/state';
    const origin = $derived(page.url.origin);
</script>

<svelte:head>
    <title>CLI — capgo-update-lite</title>
</svelte:head>

<header class="mb-6">
    <h1 class="h2">Publishing from the CLI</h1>
    <p class="text-surface-600-400 text-sm">
        The browser upload flow above is convenient for one-off uploads; for everything else use
        <code>capgo-update-lite-cli</code>. The same admin token logged into this dashboard works
        as <code>CAPGO_ADMIN_TOKEN</code>.
    </p>
</header>

<section class="card preset-filled-surface-100-900 space-y-4 p-5">
    <div>
        <h2 class="h4 mb-2">1. Install</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpm add -D capgo-update-lite-cli
# or use it ad-hoc:
pnpx capgo-update-lite-cli --help</code
            ></pre>
    </div>

    <div>
        <h2 class="h4 mb-2">2. Environment</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >export CAPGO_SERVER_URL="{origin}"
export CAPGO_ADMIN_TOKEN="…"   # same value you logged in with</code
            ></pre>
        <p class="text-surface-600-400 mt-2 text-xs">
            Anything that lives in env can also live in <code>capgo-update-lite.json</code> — the
            admin token is the one thing you should keep in env / secret store.
        </p>
    </div>

    <div>
        <h2 class="h4 mb-2">3. Scaffold the project config (one-time)</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpx capgo-update-lite-cli init</code
            ></pre>
        <p class="text-surface-600-400 mt-2 text-xs">
            Writes <code>capgo-update.config.json</code> with <code>appId</code>, <code>serverUrl</code>,
            <code>channel</code>, and <code>distDir</code> placeholders. Edit it once and commit
            it.
        </p>
    </div>

    <div>
        <h2 class="h4 mb-2">4. Register the app on the server (one-time)</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpx capgo-update-lite-cli apps add com.example.app --name "Example"</code
            ></pre>
    </div>

    <div>
        <h2 class="h4 mb-2">5. Publish a build</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpx capgo-update-lite-cli publish</code
            ></pre>
        <p class="text-surface-600-400 mt-2 text-xs">
            With <code>capgo-update.config.json</code> committed, that's the whole command. The bundle
            version is sourced from <code>package.json</code>; if it matches the active bundle on
            the channel, the CLI prompts for a <code>patch</code>/<code>minor</code>/<code>major</code>
            bump and writes the new value back to <code>package.json</code> before publishing.
            Native min-build floors are auto-detected from <code>android/</code> and
            <code>ios/</code>.
        </p>
    </div>

    <div>
        <h2 class="h4 mb-2">6. Promote a previously-uploaded bundle</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpx capgo-update-lite-cli bundles promote 1.4.2 --app com.example.app</code
            ></pre>
        <p class="text-surface-600-400 mt-2 text-xs">
            Activates an existing bundle without re-uploading — useful for rolling forward to a
            previously-deactivated version.
        </p>
    </div>

    <div>
        <h2 class="h4 mb-2">CI usage</h2>
        <p class="text-surface-600-400 text-xs">
            In non-interactive contexts the bump prompt is replaced by a hard fail — bump
            <code>package.json</code> in your release script (e.g.
            <code>npm version patch</code>) before invoking <code>publish</code>, or pass
            <code>--bundle-version &lt;semver&gt;</code> explicitly. Pass
            <code>--version-exists-ok</code> to make the publish idempotent (exits 0 if the
            version is already published).
        </p>
    </div>
</section>
