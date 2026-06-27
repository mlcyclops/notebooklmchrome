# Publishing checklist (one-click install for users)

Once this is live on the Chrome Web Store, users install with a single click (no
"Load unpacked"). Here is everything needed to get there. Most of it is already
prepared in this repo.

## 0. Build the upload artifact

```bash
npm run package
```

This produces:
- `dist/chrome.zip` -> Chrome Web Store
- `dist/edge.zip` -> Microsoft Edge Add-ons
- `dist/firefox.zip` -> Firefox Add-ons (AMO)

Each zip already includes the manifest and the `icons/` (16/32/48/128) required by
the stores.

## 1. Chrome Web Store

1. Create a developer account at https://chrome.google.com/webstore/devconsole
   (one-time 5 USD registration fee).
2. **Add new item** and upload `dist/chrome.zip`.
3. Fill the listing from [`store-listing.md`](store-listing.md): item name, summary,
   detailed description, category (Productivity), language.
4. **Graphic assets:** the 128 icon is taken from the package automatically. Add 1 to
   5 screenshots at 1280x800 (see the screenshot sources in `store-listing.md`).
5. **Privacy practices:**
   - Single purpose: see `store-listing.md`.
   - Permission justifications: see [`privacy-policy.md`](privacy-policy.md)
     (`storage`, NotebookLM host access, optional localhost host access).
   - Data usage: declare that **no user data is collected or sold**.
   - Privacy policy URL:
     `https://github.com/mlcyclops/notebooklmchrome/blob/main/store/privacy-policy.md`
6. Submit for review. After approval, the public listing gives users a one-click
   **Add to Chrome**.

> Trademark note: list the item as "Folderizer for NotebookLM" rather than leading
> with "NotebookLM", to respect Google's product trademark.

## 2. Microsoft Edge Add-ons (optional)

Upload `dist/edge.zip` at https://partner.microsoft.com/dashboard/microsoftedge .
Reuse the same listing copy and privacy policy. No registration fee.

## 3. Firefox Add-ons / AMO (optional)

Upload `dist/firefox.zip` at https://addons.mozilla.org/developers/ . The Firefox
build already has the Gecko-adapted manifest (`browser_specific_settings.gecko`).

## 4. After publishing

- Update the README "Install" section to link the store page and show an
  **Add to Chrome** button.
- The desktop app's "Connect the extension" flow can then point users to the store
  listing instead of "Load unpacked".
