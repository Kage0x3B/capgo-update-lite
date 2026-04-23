import type { RequestHandler } from './$types';

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>capgo-update-lite API</title>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export const GET: RequestHandler = () =>
    new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
