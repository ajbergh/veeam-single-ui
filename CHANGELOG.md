# Changelog

## 1.0.0 — release candidate

- **Clean installation:** normal `npm install` and `npm ci` work without peer-dependency bypasses. Unused React 18-only packages are removed, React/Next.js and compatible dependencies are updated, and CI checks the dependency tree.
- **Protection Lens:** Overview, Job Operations, Capacity Watch, and Capacity Forecast with a selectable default view.
- **Storage planning:** retention-aware file projections, collected capacity history, immutability investigation, and backup hygiene.
- **Planning cache:** source-scoped server-memory snapshots refresh every 30 minutes in the background for saved VBR connections. Manual Refresh bypasses the interval; transient failures keep the previous snapshot and its collection time visible.
- **Job creation:** a guided VMware/Hyper-V builder with native payload review and reusable Policy Profiles.
- **Investigation:** workload errors, session/task logs, supported retry chains, restore-point evidence, topology, and workload resilience.
- **Operations throughout:** refreshed VBR, Microsoft 365, Veeam ONE reports/alarms, and administration views.
- **Navigation and appearance:** search previews, expandable filter rails, sortable dates, compact controls, phone navigation, and three Glass themes.
- **Interface languages:** eleven bundled locales with browser detection, a saved preference, and localized date/number formatting in migrated views. VBR widgets, Policy Profile editors, creation flows, job/session investigations, repository and restore-point details, and Microsoft 365 investigations include their labels, counts, statuses, descriptions, and known application diagnostics.
- **Localized AI summaries:** health-summary requests use the selected interface language while keeping quoted provider and source diagnostics intact.
- **Connection showcase:** feature screenshots on `/connect` with localized captions, manual navigation, pause/play controls, and reduced-motion support.
- **Application settings:** a language/region panel and optional managed HTTPS with certificate inspection, validated PEM replacement, and live certificate reload. Existing reverse-proxy deployments remain supported.
- **Release documentation:** updated setup, localization coverage, HTTPS deployment guidance, PR copy, illustrated release notes, and a screenshot gallery with capture provenance.

[Full release notes](docs/releases/v1.0.0.md) · [Screenshot checklist](docs/releases/v1.0.0-screenshots.md)

Earlier releases are available in the [GitHub release history](https://github.com/jorgedlcruz/open-backup-ui/releases).
