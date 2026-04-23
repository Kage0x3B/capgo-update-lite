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
        The browser upload flow above is a convenience; CI/release scripts should use the
        <code>capgo-update-lite-cli</code> package. Both paths hit the same
        <code>/admin/bundles/*</code> endpoints.
    </p>
</header>

<section class="card preset-filled-surface-100-900 space-y-4 p-5">
    <div>
        <h2 class="h4 mb-2">1. Environment</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >export CAPGO_SERVER_URL="{origin}"
export CAPGO_ADMIN_TOKEN="…"   # same value you logged in with</code
            ></pre>
    </div>

    <div>
        <h2 class="h4 mb-2">2. Register the app once</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >curl -sS -X POST "$CAPGO_SERVER_URL/admin/apps" \
  -H "authorization: Bearer $CAPGO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '&#123;"id":"com.example.app","name":"Example"&#125;'</code
            ></pre>
    </div>

    <div>
        <h2 class="h4 mb-2">3. Publish a build</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >pnpm dlx capgo-update-lite-cli com.example.app 1.1.0 ./build --activate</code
            ></pre>
        <p class="text-surface-600-400 mt-2 text-xs">
            Flow: zip → <code>POST /admin/bundles/init</code> → presigned R2 PUT →
            <code>POST /admin/bundles/commit</code> (server re-hashes to verify).
        </p>
    </div>

    <div>
        <h2 class="h4 mb-2">4. Toggle active manually</h2>
        <pre class="bg-surface-900 text-surface-50 overflow-x-auto rounded p-3 text-xs"><code
                >curl -X PATCH "$CAPGO_SERVER_URL/admin/bundles/42" \
  -H "authorization: Bearer $CAPGO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '&#123;"active":true&#125;'</code
            ></pre>
    </div>
</section>
