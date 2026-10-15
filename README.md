# Stormworks Stippler

A local upload/download tool that adds lighter and darker paint variations to Stormworks vehicle XML files. Requires Python 3.10 or newer; no third-party dependencies.

Preview and conversion run entirely in the browser; files are not uploaded to a server. The converter is bundled into the single HTML file so embedded previews do not need to load separate JavaScript assets. You can also open `web/index.html` directly or host the contents of `web/` on a static site. The Python server is an optional local file server with a separate conversion API. The browser and Python converters each reproduce their own output for a given seed; their random sequences differ.

Run `python3 server.py` from this directory, then open `http://127.0.0.1:8000` in your browser. Choose a vehicle XML, adjust the strength, and download a separate `-stippled.xml` file. Your original is never overwritten. The same seed and settings produce the same output.

Strength is the maximum random offset per RGB channel (0–50). Each painted object gets one offset shared by its supported colors, preserving their relationship except where channels reach 0 or 255.

After upload, a preview shows the three most common paint colors with their original swatches and a grid of sample output shades. It updates with strength and seed. Ranking counts supported paint-color occurrences, including individual face colors, rather than visible surface area. The tiles sample colors from the actual conversion; their arrangement is illustrative and does not reproduce vehicle geometry or game lighting.

The format adapter handles six-digit hexadecimal `bc`, `ac`, `bc2`, and `bc3` paint attributes and `sc` face-color lists on `<o>` elements within a `<vehicle>` document. Face-list markers are preserved. It preserves other XML text, including comments, whitespace, and declarations. A file with no supported colors produces an error. Unsupported attribute formats remain unchanged. Validated against the supplied Medium Tank XML for paint changes and preservation of non-paint data; an in-game import check is still needed. Keep a backup of your creation.

Run tests with `python3 -m unittest discover -s tests -v`.

The server binds to loopback by default. For a cloud host that provides its own authenticated port access, use `python3 server.py --host 0.0.0.0`. Do not expose it directly to the public internet.
