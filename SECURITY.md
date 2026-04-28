# Security Policy

## Supported Versions

Security fixes are currently expected for the active `0.1.x` line.

## Scope

Danevan is a local desktop database client built with Electrobun, Bun, and Vue. It is not a sandboxed database proxy or a multi-user hosted service.

Security reports are especially valuable for issues involving:

- database credential storage or accidental credential disclosure
- unsafe SQL execution surfaces or privilege escalation beyond the connected database account
- IPC boundary validation between the renderer and the Bun backend
- local file access, path handling, and editor-launch flows
- command execution, shell injection, or unsafe subprocess behavior
- runtime download and dependency provisioning behavior
- secret leakage through logs, fixtures, screenshots, release artifacts, or tracked files

## Current Security Model

The project intentionally keeps the native shell small:

- the Bun/Electrobun side handles database access, app metadata, credentials, subprocesses, and OS integrations
- the Vue renderer owns most interaction logic and workspace state
- app-facing request methods are centralized and typed across the IPC boundary

This reduces the amount of privileged code, but it does not eliminate risk. The backend still has direct access to the local filesystem, subprocess execution, and remote databases on behalf of the signed-in user.

## Important Behavior And Trust Boundaries

### SQL Runs With The Target Database Privileges

When you run SQL from Danevan, it executes with the privileges of the selected database account. The app does not try to downgrade or sandbox that authority.

For that reason:

- avoid connecting to production with unnecessarily privileged accounts
- treat saved scripts and ad hoc SQL as potentially destructive
- review schema-changing actions carefully before applying them

### Credentials

Saved connection passwords are currently integrated with macOS Keychain on the documented macOS release target.

If you are testing outside that target, do not assume all platform credential flows are equally hardened.

Never commit:

- real credentials
- `.env`
- local database files with sensitive data
- screenshots or fixtures containing secrets

### Optional Runtime Downloads

Some optional capabilities can provision or download runtime dependencies:

- MS Access support can use bundled runtime assets or download runtime jars on first use
- SQL diagnostics/formatting can provision a managed local SQLFluff runtime if one is not already available

These behaviors are part of the local app experience and should be treated as security-relevant surfaces. Reports about unsafe download handling, integrity issues, or unexpected execution paths are in scope.

### Custom Formatter Code

Custom grid formatters are user-defined JavaScript templates executed in a worker context. Treat imported or shared formatter definitions as code, not as passive data.

Reports about unsafe formatter execution boundaries or privilege escalation from that feature are in scope.

## Reporting

If you discover a security issue, do not open a public issue with exploit details.

Instead, contact the maintainer privately and include:

- a clear description of the issue
- affected versions or commit range if known
- reproduction steps or a proof of concept
- impact assessment
- any suggested remediation if you have one

If a dedicated security contact address is added later, this file should be updated to use it.

## Disclosure Goals

The intended handling process is:

1. Confirm the report and reproduce the issue.
2. Assess severity, scope, and affected versions.
3. Prepare and validate a fix.
4. Publish the fix.
5. Disclose the issue once users have a reasonable update path.

## Maintainer Hygiene

For maintainers preparing public releases:

- run `bun run release:audit`
- verify generated build artifacts are not tracked by git
- verify docs do not contain stale personal paths or secrets
- prefer signed and notarized public macOS builds when possible

## Secrets And Test Data

Please avoid sending:

- real database credentials
- production datasets
- personal secrets
- proprietary schema dumps unless necessary

Redacted examples and minimal reproductions are strongly preferred.
