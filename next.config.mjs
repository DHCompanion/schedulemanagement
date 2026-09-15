// Mount the whole app under BASE_PATH so its assets resolve behind the Skiles
// Connect same-domain rewrite (sgconnect.dev/schedule-manager/* -> this
// deployment). Without it Next emits root-absolute /_next/... URLs that resolve
// against sgconnect.dev and get swallowed by the OS SPA catch-all: the app
// loads and every asset 404s. Empty when the tool runs standalone.
const basePath = process.env.BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  assetPrefix: basePath || undefined,
  // basePath prefixes <Link> and router navigation but NOT raw fetch() URLs or
  // <form action>. lib/http.ts prefixes those and needs the value in the browser
  // bundle, so inline it here from the single server-side variable.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The Chromium binary behind the lookahead PDF and its launcher must stay out
  // of the server bundle: webpack cannot bundle a brotli-packed executable, and
  // Playwright resolves it from disk at runtime.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Externalizing keeps the package a runtime require, but @sparticuz loads its
  // brotli chromium from bin/ by file path — the tracer never sees that as an
  // import and prunes it, so the deployed function 500s with "input directory
  // .../@sparticuz/chromium/bin does not exist". Force the files into the route.
  outputFileTracingIncludes: {
    "/api/export/lookahead-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
