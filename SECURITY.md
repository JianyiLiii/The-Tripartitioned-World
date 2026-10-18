# Security boundaries

## Public preview

Publish only `docs/` as a static website. It contains anonymous sample data, browser code, and documentation screenshots. It does not contain the Python server, account configuration, databases, or session data.

- No account creation, authentication, uploads, API endpoints, or meeting writes.
- No analytics, remote fonts, third-party scripts, or background API calls.
- A Content Security Policy allows scripts and styles only from the same origin and sets `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, and `object-src 'none'`.
- Text is inserted using DOM text nodes rather than interpolated HTML.
- The current device clock drives the sample dates. Choices reset on reload; only the interface language is stored locally.
- The asset builder uses an explicit allowlist and substitutes client-only clock and UI modules. Regression checks reject network APIs, unsafe HTML sinks, missing imports, and unexpected published files.

Static isolation prevents demo interactions from changing any private workspace. It is not a guarantee against every attack or service outage. Availability, bandwidth limits, HTTPS, and traffic abuse handling depend on the static host. An HTML meta policy cannot supply every HTTP response security header; framing restrictions require a host that supports the appropriate headers.

## Full application

The Python application is supplied as source for local use. The static preview's isolation does not make a separately hosted application secure automatically. Do not expose the default name-only local mode to the public internet. Configure approved-account access, HTTPS, rate limits, secure session settings, private storage, and backups before hosting an actual workspace. Replace initial passwords for public deployments.

Keep `data/`, account lists, environment files, backups, logs, and credentials out of commits and issue attachments. Test data and screenshots must remain synthetic.

## Reporting

For a reproducible issue involving only the static sample, open an issue with browser details and reproduction steps. Do not include passwords, tokens, real user data, or private deployment details in a public issue. For a sensitive issue, use GitHub private vulnerability reporting if enabled by the maintainer.
