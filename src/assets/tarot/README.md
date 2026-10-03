# Classic Rider–Waite–Smith Tarot images

This directory contains all 78 historical **Pam-A** card scans from the
[TaionWC image set on Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)).
The artwork is by **Pamela Colman Smith**, dated **1910** in the source records.
Every individual Commons file page declares **Public domain**. These declarations,
including their original `extmetadata`, were captured on **2026-10-03** in
`assets-sources.json`. The project MIT license does not replace the source
artwork's public-domain status.

Each card has its own description-page link, original-file URL, Commons file
SHA-1, original SHA-256, local WebP SHA-256, and processing description in the
manifest. No modern repainting or recoloring was used.

WebP images are 576 × 960 pixels, quality 80. The source is resized proportionally
and placed on a narrow neutral paper border when needed. The entire historical
scan, including the English title, is retained without cropping. The matching
Chinese card name is rendered by the interface.

To verify all 78 checked-in assets and rebuild their offline data URI map:

```sh
node scripts/build-tarot-assets.mjs
```

The generated `src/client/tarot-assets.ts` uses only embedded data URIs. Viewing
and drawing cards does not request a Commons URL or any remote image endpoint.
The downloaded original scans are kept in the ignored `.local/tarot-originals/`
directory for development verification and are excluded from the distributable.
