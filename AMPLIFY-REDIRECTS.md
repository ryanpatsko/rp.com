# Amplify redirects (match wild-child, with xml + webmanifest)

Your current rules are the same as wild-child. The second rule uses a regex that rewrites to `index.html` for any path whose extension is **not** in the exclusion list. That list was missing **xml** and **webmanifest**, so `/sitemap.xml` and `/site.webmanifest` were being rewritten to the app (hence the manifest parse error and sitemap not loading).

**Fix:** Add `xml` and `webmanifest` to the regex’s exclusion list so those files are served as static assets.

Replace your Amplify “Rewrites and redirects” with the contents of **`amplify-redirects.json`**. Only the second rule changes: the `(css|gif|ico|...|json)` part becomes `(css|gif|ico|...|json|xml|webmanifest)`.

No new rules, same structure as wild-child.
