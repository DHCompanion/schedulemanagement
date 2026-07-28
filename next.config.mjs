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
};

export default nextConfig;
