# Import the v1.0.0 release branch into GitHub Desktop

The Desktop package restores the complete prepared `features/v1.0.0` branch, its Git history, application source, dependency lockfile, documentation, and images. The repository remote is `https://github.com/jorgedlcruz/open-backup-ui.git`; `main` is the pull-request base.

## Restore the download

1. Download **every numbered ZIP** from the release preparation Page into the same folder. Pages limits each attachment to 10 MiB, so the complete Git bundle is divided between normal ZIP files.
2. Extract **Part 1** into a new folder. Keep the other ZIPs beside that extracted folder. You can also extract all parts into one common folder.
3. Double-click **Prepare repository.cmd** inside the extracted Part 1 folder. The launcher finds the remaining ZIPs, checks their SHA-256 hashes, joins the bundle, and restores it offline into a new **open-backup-ui** subfolder. It refuses to overwrite an existing checkout.
4. In **GitHub Desktop → File → Add local repository**, choose that restored **open-backup-ui** subfolder. The selected branch should be **features/v1.0.0**.

The single full ZIP is an alternative for local delivery: extract it and run the same launcher. GitHub Desktop or Git for Windows must be installed so the launcher can use Git. Preparation does not fetch, push, create a tag, or publish a release.

## Prepare the pull request

Fetch and review the current GitHub state in Desktop, then publish the prepared branch. Open a pull request from **features/v1.0.0** into **main**. Use the first heading of **PR.md** as the title and the remaining Markdown as its description. Its image links become available after the branch has been pushed.

**README.md** is included both beside the launcher and inside the restored repository. The full illustrated release notes, gallery, and localization guide are under `docs/` in the checkout.

## Prepare the GitHub release

After reviewing and merging the pull request, create the **v1.0.0** release tag at the final commit containing these changes. Paste **RELEASE.md** into the release description. Its 43 image links use the `v1.0.0` tag and resolve when that tag is published. Keep the tag on the same final source snapshot as the release notes and images.

For development, use Node.js 22 and run `npm ci`, then `npm run dev`.

## Rebuild the Desktop package

The package builder consumes an already prepared Git bundle and snapshot metadata. It does not modify repositories:

```powershell
node scripts/package-desktop.cjs --bundle artifacts/open-backup-ui-v1.0.0.bundle --metadata tmp/desktop-preparation/snapshot.json --out artifacts/desktop
```

The metadata records `version`, `branch`, `commit`, `baseCommit`, `remote`, `sourceFiles`, and `images`. The builder writes a full ZIP, numbered Page ZIPs, a bundle manifest, checksums, and the offline restoration scripts. Saved connections, runtime data, local environment files, private certificates, dependencies, build output, and conversation attachments are excluded from the prepared source snapshot.
