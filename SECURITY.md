# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please report it responsibly. **Do not open a public issue.**

Email [TODO: INSERT CONTACT EMAIL] with:

- A description of the vulnerability
- Steps to reproduce it
- Any relevant files or links

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Scope

This policy covers the tracked OCI API, operator dashboard, Pages landing page,
operational documentation, and CI workflows. It does not cover local
BACKUP_RESOURCES contents or infrastructure outside this repository.

## What Counts as a Vulnerability

- CI workflows that could be exploited (e.g., script injection via PR titles or branch names)
- Credentials, API keys, or secrets accidentally committed to the repo
- Operational examples or documentation that encourage insecure practices

## What Does NOT Count

- Feature requests or general feedback

## Credit

We are happy to credit reporters in release notes unless you prefer to remain
anonymous.
