# Releasing

This document covers the current maintainer workflow for producing a public-safe Danevan release.

The maintained release path in this repository is the macOS Electrobun build on Apple Silicon.

## Release Overview

The release process currently has four parts:

1. Validate the working tree and docs.
2. Run checks, tests, and production builds.
3. Produce the macOS app bundle and DMG.
4. Verify artifacts, then publish from a git tag.

## Preflight

Before cutting a release:

- make sure the working tree does not contain generated outputs, local-only data, secrets, or personal paths
- make sure docs reflect the real product state
- make sure the release notes and changelog match the version being published
- make sure branding and bundle metadata still refer to Danevan

Recommended checks:

```bash
bun run release:audit
git status --short
git ls-files | rg '^(release|build|dist|artifacts|node_modules|\.vite)/'
```

The audit script scans tracked files for likely publish-sensitive text such as local `/Users/...` paths and email addresses and also checks that generated outputs are not tracked by git.

## Environment Variables

For ordinary local validation, no signing variables are required.

For signed builds, provide:

- `ELECTROBUN_DEVELOPER_ID`
- `ELECTROBUN_TEAMID`

For notarized builds, also provide:

- `ELECTROBUN_APPLEID`
- `ELECTROBUN_APPLEIDPASS`

You can place these in a local `.env` file at the repository root. Do not commit `.env`.

`.env.example` is currently minimal and only documents an example remote-test URL, so do not assume it is a complete release configuration template.

## Validation

Install dependencies:

```bash
bun install
```

Run the normal release-facing validation:

```bash
bun run release:validate
```

That runs:

- `vitest run`
- `vp run build`

For a broader local confidence pass, run:

```bash
bun run ready
```

That runs:

- `vp check`
- `vp run -r test`
- `vp run build`

If you made TypeScript or Vue changes during release prep, it is also reasonable to run:

```bash
bun run lint
```

## Optional Driver Checks

Remote-driver smoke checks are opt-in:

```bash
DANEVAN_TEST_MYSQL_URL=mysql://user:pass@localhost:3306/db \
DANEVAN_TEST_POSTGRES_URL=postgres://user:pass@localhost:5432/db \
bun run test:remote
```

If a URL is omitted, that driver is skipped.

For MS Access release prep, you can pre-bundle the runtime assets:

```bash
bun run bundle:msaccess-runtime
```

This is useful when you want offline MS Access support in packaged builds instead of relying on first-run runtime downloads.

## Build Outputs

Standard app build:

```bash
bun run build
```

Direct Electrobun channel builds:

```bash
bun run build:canary
bun run build:stable
```

Maintained release wrapper:

```bash
bun run release:mac
```

This wrapper:

- ensures the macOS iconset and ICNS are generated from `assets/icon.svg`
- runs `bun run build:stable`
- finds the built `.app` bundle under `build/stable-macos-${arch}`
- finds the generated `.dmg` under `artifacts/`
- installs the app into `/Applications` by default

Skip installation into `/Applications`:

```bash
bun run release:mac -- --no-install
```

Signed build:

```bash
bun run release:mac:signed
```

Signed and notarized build:

```bash
bun run release:mac:notarize
```

For signed builds, the wrapper verifies the `.app` with `codesign` and `spctl`.

For notarized builds, it also mounts the generated DMG and verifies the mounted app bundle.

## Expected Artifact Locations

After a successful release build:

- app bundle: `build/stable-macos-${arch}/*.app`
- DMG artifact: `artifacts/stable-macos-${arch}-*.dmg`

The wrapper prints the final resolved paths at the end of the run.

## Release Hygiene

Before tagging a release:

- confirm `CHANGELOG.md` contains the target version entry
- confirm `README.md`, `ROADMAP.md`, and `SECURITY.md` still match the product
- confirm generated assets and local app data are not staged
- confirm no secrets or personal machine paths are present in tracked files
- confirm the version in `package.json` is the version you intend to ship

## Suggested Publish Flow

1. Update the version in `package.json`.
2. Update [CHANGELOG.md](CHANGELOG.md) and any related docs.
3. Run `bun run release:audit`.
4. Run `bun run release:validate`.
5. Optionally run `bun run ready`.
6. Build the public artifact with `bun run release:mac` or the signed/notarized variant.
7. Confirm the `.app` and `.dmg` exist in the expected locations.
8. Create and push the matching git tag.
9. Create a GitHub Release from that tag.
10. Use the matching [CHANGELOG.md](CHANGELOG.md) entry as the release notes.
11. Upload the generated DMG from `artifacts/`.

## Public Distribution Notes

Unsigned builds are acceptable for local development and private testing, but they are not suitable for normal internet distribution because Gatekeeper will treat them as untrusted.

For public releases, prefer:

- signed builds at minimum
- signed and notarized builds when possible
- GitHub Releases for binary distribution

Do not commit built binaries, DMGs, or unpacked release artifacts to the repository.
