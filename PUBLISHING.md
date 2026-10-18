# Publish with GitHub Desktop

This folder is the public source package. Do not upload a parent folder or a production checkout.

1. In GitHub Desktop, choose **File → Add local repository** and select this folder. The prepared local folder already has a clean initial commit. If you extracted the source ZIP instead, initialize a repository in that extracted folder first.
2. Check the changed-file list. There should be no real account lists, `.env` files, databases, backups, or hosting credentials.
3. Under **Repository → Repository settings → Git config**, use `JianyiLiii` as the author name and your GitHub no-reply email. This avoids publishing a personal email or a different display name in commit history.
4. Commit the public source, then choose **Publish repository**.
5. Set the name to `The-Tripartitioned-World` and description to `Coordinate availability across time zones and find a meeting time for everyone.`
6. Choose your personal account **JianyiLiii**, not an organization. Uncheck **Keep this code private**, then publish.

## Enable the no-login preview

1. Open the published repository on GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Select **main** and **/docs**, then **Save**.
5. Wait for the Pages deployment to finish. Open the published URL shown on that page in a signed-out browser.

Expected address: https://JianyiLiii.github.io/The-Tripartitioned-World/

The URL becomes live only after publishing and enabling Pages. Once verified, replace the README's activation note with a direct “Try the preview” link. Set the repository's **About → Website** field to the same URL.

Publishing `docs/` exposes only static sample content. It does not deploy the Python server or connect to an existing workspace. No hosting password, API key, or custom domain is required.

See the [official GitHub Pages publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
