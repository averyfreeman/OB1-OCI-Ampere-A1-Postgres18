# Dashboard extension convention

The active dashboard supports drop-in routes registered in
extensions.config.ts. Extensions must remain inside the dashboard tree and
must use the existing session and API helpers.

## Anatomy

1. Add a folder under app/<route>/ with one or more page.tsx files.
2. Add one entry to extensions.config.ts.
3. Rebuild and verify the dashboard before enabling the route.

Extensions must not change the systemd paths, authentication model, or API
scope policy.

## Authentication

Use requireSessionOrRedirect from lib/auth for protected pages. The returned
API key may be sent only from server-side code to the OCI API using the
x-brain-key header. Never expose it to browser JavaScript or local storage.

## Backend routes

Use the existing OCI API routes when possible. If a new route is required,
add it to integrations/oci-node/src/app.ts with validation, authorization,
tests, and an additive migration when storage is needed. Agent Memory routes
must preserve workspace, project, capability, provenance, and review policy.

## Icon registry

Extensions reference icons by string name. Add a key to the ExtensionIcon
union and its SVG mapping in components/Sidebar.tsx before using it in the
registry.

## Validation

Run:

    npm run lint
    npm run build

Review the result against the active deployment unit before enabling a new
route.
