# Stormworks Stippler

A local upload/download tool that adds lighter and darker paint variations to Stormworks vehicle XML files. Requires Python 3.10 or newer; no third-party dependencies.

Preview and conversion run entirely in the browser; files are not uploaded to a server. The converter is bundled into the single HTML file so embedded previews do not need to load separate JavaScript assets. You can also open `web/index.html` directly or host the contents of `web/` on a static site. The Python server is an optional local file server with a separate conversion API. The browser and Python converters each reproduce their own output for a given seed; their random sequences differ.

Run `python3 server.py` from this directory, then open `http://127.0.0.1:8000` in your browser. Choose a vehicle XML, adjust the strength, and download a separate `-stippled.xml` file. Your original is never overwritten. The same seed and settings produce the same output.

Strength is the maximum random offset per RGB channel (0–50). Each painted object gets one offset shared by its selected colors, preserving their relationship except where channels reach 0 or 255.

In **Vary selected paint colors** mode, every supported source color is listed with a swatch, occurrence count, and unchecked checkbox. Only checked colors are changed, and only those colors get preview cards; there is no three-color preview limit. A new upload resets the selection. Select at least one color to enable download. Each preview shows the original swatch and sample output shades. It updates with strength and seed. Ranking counts supported paint-color occurrences, including individual face colors, rather than visible surface area. The tiles sample colors from the actual conversion; their arrangement is illustrative and does not reproduce vehicle geometry or game lighting.

Choose **Replace one paint color** to select any supported color found in the uploaded creation. Enter one or more replacement colors as comma-separated hex values, or use the color picker and **Add color**. Replacement colors appear as swatch cards; use the × button on a card to remove that palette entry. Each matching object randomly selects a replacement with equal probability per palette entry and applies the shade variation; matching base, accent, and face colors on that object stay consistent. Exact matches are case-insensitive. Other colors remain unchanged. Strength 0 uses the replacement colors exactly. The selected color appears first in the preview, followed by common unchanged colors. The same seed and settings reproduce the result. This mode is available in the browser interface; the separate Python API remains the all-color variation converter.

Every source color has a clickable swatch beside its hex code and occurrence count. The previous preview stays visible until the next valid result is ready.

The format adapter handles one- to six-digit hexadecimal `bc`, `ac`, `bc2`, and `bc3` paint attributes and `sc` face-color lists on `<o>` elements within a `<vehicle>` document. Omitted leading zeros are restored for display and color matching (for example, E232 is #00E232). Unchanged XML values retain their original spelling. Face-list markers are preserved. It preserves other XML text, including comments, whitespace, and declarations. A file with no supported colors produces an error. Unsupported attribute formats remain unchanged. Validated against the supplied Medium Tank XML for paint changes and preservation of non-paint data; an in-game import check is still needed. Keep a backup of your creation.

Run tests with `python3 -m unittest discover -s tests -v`.

Browser regression checks require Playwright and Chromium: run `node tests/browser.cjs`. Set `CHROMIUM_PATH` if using a system Chromium installation instead of Playwright's bundled browser.

## Live website

The GitHub Pages workflow in `.github/workflows/pages.yml` tests the converters and deploys only the static `web/` directory on every push to `main`. It can also be run manually from the Actions tab. No backend, API keys, or upload storage are needed; XML files stay in the visitor's browser.

One-time repository setup: open **Settings → Pages**, then set **Source** to **GitHub Actions**. After the workflow completes, the expected website address is `https://jpflei.github.io/Stormworks-Stippler/`. The deployment job reports the actual URL. If the repository is private, GitHub Pages availability depends on the account plan.

If Pages is configured to deploy from the `main` branch root instead, the root `index.html` forwards visitors to the app in `web/`, preventing the README from becoming the homepage. GitHub Actions remains the recommended source because it runs checks before publishing.

The server binds to loopback by default. For a cloud host that provides its own authenticated port access, use `python3 server.py --host 0.0.0.0`. Do not expose it directly to the public internet.
