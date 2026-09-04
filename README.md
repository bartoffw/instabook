# Instabook

Create an Ebook from any web page or PDF instantly and beautifully. Now you can build your own Ebook with chapters from multiple pages.

![Instabook conversion](/screenshots/extension-large-horizontal.png)

[Talk with us on Mastodon](https://mastodon.social/@instabook)

## Description

Instabook is a browser extension that makes it easy to convert any web page with content into a stylish and clean Ebook for free.
You can save web pages as EPUB files and read them offline on your computer or Ebook reader.

You also get to preview the cover page of your Ebook before the epub file is generated, and choose which image
from the page ends up on it - or upload your own.

The latest version also allows you to build a multi-chapter Ebook with each chapter being a snapshot of a different page.
Read the *Creating an Ebook with chapters* section for details.

Instabook can also convert a **PDF file into an EPUB**, entirely on your device. This feature is **experimental** —
see the *Converting a PDF to EPUB* section for details.

## Features

* One click conversion of the current page into a clean, reader friendly EPUB.
* A live preview of the cover page with the title, the author, the estimated read time and the source domain.
* Pick the cover image from any picture found on the page, or upload one of your own.
* Build a multi-chapter Ebook out of several pages, then rename, reorder and remove the chapters before downloading.
* Convert a local PDF file into an EPUB on your own device, with a review screen to check the result first.
* Optional extras: including the comments of the page, and shortening repeating chapter titles.
* Works in Firefox and in Chromium based browsers (Chrome, Brave, Vivaldi, Edge).

## Installation

To install Instabook, just download and install the latest version of the extension from your browser's extension page.
The extension is also available on its [GitHub page](https://github.com/bartoffw/instabook).

## Usage

To use Instabook, follow these steps:

1. Navigate to the web page you want to convert.
2. Click the Instabook icon in your browser's toolbar.
3. *Optional step:* Additionally, you can change the title of your Ebook by clicking on it and editing it. Once you're done, just hit Enter or click the area around the title.
   1. Hovering over the cover preview reveals a small row of buttons. The &#8630; button brings the original title back.
4. *Optional step:* Choose a different cover image - see the *Choosing the cover image* section below.
5. *Optional step:* Clicking the "Downloaded from" line at the bottom of the cover removes it from the generated Ebook.
6. Click "Download".
7. Wait for the conversion and download process to complete.
8. Enjoy!

### Choosing the cover image

Version *1.4.0* added a cover image picker for a single page Ebook.

Every picture found on the page that is big enough to make a decent cover (at least 100x100 pixels) becomes a
candidate. The images of the article itself come first, followed by the ones found elsewhere on the page, and the
generic Instabook cover always closes the list. Logos, menu icons and other page furniture are left out.

1. Hover over the cover preview - arrows appear on both sides and a row of dots at the bottom, one per candidate.
2. Click the arrows or the dots to switch between the images. The one shown when you hit "Download" is the one used.
3. The article image of the page (its `og:image`, the one social networks show) is selected by default. If the page
   doesn't define one, the first image found in the article is used instead.
4. Your choice is remembered per page, so reopening the extension on the same page brings it back.

To use a picture of your own instead, click the &#128247; button in the row of buttons that shows up when you hover
over the cover, then pick an image file. It replaces all the images found on the page and becomes the cover right
away. Large images are scaled down before they are stored. The &#10006; button next to it removes the uploaded image
and brings the ones found on the page back.

### Creating an Ebook with chapters

Version *1.2.0* added support for creating Ebooks with chapters. There's now an additional "Add as a chapter" button and
a subpage for managing chapters of the Ebook.

To start using this feature, follow these steps:

1. Browse to the page you want to add as the Ebook chapter and click "Add as a chapter".
   1. The chapter count will show up on the right side of the button. That number is also a button that opens the chapter management screen.
2. Keep browsing to the pages you want to include in your Ebook and adding them using the new button.

   ![Add as a chapter](/screenshots/add-as-chapter.png)

3. Once you're done adding the chapters, click on the chapter count button - this will open the chapter management screen.

   ![Chapter count button](/screenshots/chapter-count.png)

4. The cover image is a carousel showing the generic cover by default, but you can change it to any cover from the added chapters you want.
   1. The cover of each chapter is the image that was selected for it on the main screen, so picking a different one there changes what this carousel offers. Uploading your own image is currently limited to a single page Ebook.
5. The cover title also can be changed - just click on it and edit it.
6. Then, scroll down to see the chapter list and manage it.
   1. Each chapter name can be edited by clicking on it.
   2. The chapter list can be also reordered using the triangle buttons on the left.
   
      ![Instabook conversion](/screenshots/reorder-chapters.png)
   
   3. Each chapter can be deleted with the "X" button on the right.
   
      ![Delete chapter](/screenshots/delete-chapter.png)
   
   4. There's also a "Delete All" button at the bottom which clears all chapters to start again.
7. Once you're done with your edits, click on the "Download X Chapters" button (the X will be a number of chapters added) to get the file.
8. To go back to the main screen just click on the "X" in the top-right corner.

   ![Chapters header](/screenshots/chapters-header.png)

### Converting a PDF to EPUB (experimental)

Instabook can also turn a PDF file into an EPUB. The PDF is parsed and converted entirely on your device —
nothing is uploaded anywhere.

1. Click the Instabook icon in your browser's toolbar, then click the "PDF" button and pick a PDF file.
2. The file opens in a full-tab review screen with the original PDF on the left and the parsed result on the right,
   so you can check the conversion before downloading.
   1. Click a parsed block to jump to its page in the original PDF, or hover it and click the &times; to remove it
      (removed blocks can be brought back with Undo).
   2. If paragraphs are being merged together or split apart incorrectly, adjust the "Paragraph factor" slider and
      the preview will re-parse automatically.
   3. Charts and diagrams made up of many small embedded images are automatically grouped into a single flattened
      image where possible; the "Aggressiveness" slider controls how readily scattered image fragments get grouped
      together. For a chart or diagram the automatic grouping doesn't handle well, drag a rectangle over it in the
      original PDF pane and add it as one flattened image instead.
   4. The "Diagnostics" button shows a per-line trace of how the parser interpreted the PDF, useful for
      understanding why a specific line, image or table came out the way it did.
3. Click "Convert" to generate and download the EPUB.

This feature is still experimental and won't handle every PDF layout perfectly. If a specific PDF doesn't convert
correctly, please report it on the [GitHub page](https://github.com/bartoffw/instabook/issues) — the review screen
has a pre-filled link for this.

### Availability

The extension is available for most of the modern browsers:

* [Firefox](https://addons.mozilla.org/pl/firefox/addon/instabook/)
* [Chrome, Brave, Vivaldi](https://chromewebstore.google.com/detail/instabook/flabhaeaccijjbjmnchngohnpjiphkhl)
* [Edge](https://microsoftedge.microsoft.com/addons/detail/instabook/dkdkmfokibfehifljhmoedmjbiahibkg)
* Opera - waiting

## Roadmap

- release the extension for mobile (Firefox)
- adding multiple language support for the extension
- ~~adding config page~~ - implemented
- ~~customizing the title page in the Ebook (adding a cover image)~~ - implemented in v1.4.0
- ~~PDF to EPUB conversion~~ - implemented in v1.3.0, still experimental — improving conversion accuracy across more PDF layouts

## Configuration

The settings are opened with the &#9881; button in the bottom-right corner of the extension popup. A green dot on
that button means at least one of them is turned on. All of them are **experimental** and may sometimes fail.

| Setting | What it does |
| --- | --- |
| Include comments | Keeps the comments of the page in the generated Ebook, when the extension manages to find them. |
| Shorten repeatable titles | Strips the text that repeats across the chapter titles of a multi-chapter Ebook, for example the site name every title ends with. |

The settings are shared by every page and are stored locally in the browser.

## Privacy

* The page is parsed and the EPUB is built inside your browser. The text of the page is never sent anywhere.
* The images embedded in the Ebook are downloaded through a CORS proxy hosted at `images.instabook.site`, because
  the browser blocks the extension from fetching most images directly. This means the **addresses** of those images
  (and therefore the domain of the page you are converting) reach that proxy. The source of the proxy is in this
  repository, in [src/cors-proxy.php](src/cors-proxy.php).
* The PDF to EPUB conversion never leaves your device - no proxy is involved there.
* Titles, chapters, settings and the covers you pick or upload are kept in the local storage of your browser only.

## Building the extension

The extension utilizes npm build scripts to use custom build configurations for each supported browser.
All of them are defined in `src/package.json`, so they have to be run from the `src` folder:

```
cd src
npm run build
```

This builds the extension for all browsers into `src/dist/firefox` and `src/dist/chrome`. Both folders can be loaded
straight into the browser as an unpacked (Firefox: temporary) extension.

Running `npm run clean` cleans the `dist` folder. The dist folder is also cleaned before every build.

The extension can be also zipped and prepared for distribution (uploading to extension stores) using `npm run release`.
This will build one zip file for each standard (Firefox and Chromium).

The two browsers are served from the same sources in `src`, the build just picks the right pieces:

| | Firefox | Chromium |
| --- | --- | --- |
| Manifest | `manifest.firefox.json` (v2) | `manifest.chrome.json` (v3) |
| Background | `scripts/background.firefox.js`, a non-persistent background page that also builds the file | `scripts/background.chrome.js`, a service worker driving an offscreen document (`offscreen/`) that builds the file |

`npm test` runs the unit tests of the parts that are pure logic and need no browser around them - the chapter title
shortening (`tests/titles.test.cjs`) and the escaping of the text that goes into the generated files
(`tests/epub-xml.test.cjs`). They need nothing installed.

[TESTING.md](TESTING.md) holds the list of pages worth checking before a release.

## Troubleshooting

Please submit any problems you find on the [GitHub page](https://github.com/bartoffw/instabook/issues).

## Contributing

Propositions for new features are welcome. Please submit them on the [GitHub page](https://github.com/bartoffw/instabook/issues).

## Sponsor this project

[![Sponsor with Crypto](https://img.shields.io/badge/Sponsor-BTC%20|%20ETH%20|%20USDT%20|%20XNO%20|%20XRP%20|%20XMR-orange?style=for-the-badge&logo=bitcoin&logoColor=white)](https://github.com/bartoffw/instabook/blob/main/DONATE.md)

See the [funding page](https://github.com/bartoffw/instabook/blob/main/DONATE.md) to choose the right option for you.

## Credits

* The extension is utilizing the [Readability](https://github.com/mozilla/readability) library to generate the Ebook content.
It's the same library that is used by Mozilla Firefox in the [Firefox Reader View](https://support.mozilla.org/kb/firefox-reader-view-clutter-free-web-pages).
* The PDF files are parsed with Mozilla's [PDF.js](https://github.com/mozilla/pdf.js).
* The EPUB archive is built with [JSZip](https://stuk.github.io/jszip/) and saved with
[FileSaver.js](https://github.com/eligrey/FileSaver.js), the content is sanitized with
[DOMPurify](https://github.com/cure53/DOMPurify), and the popup is built with
[Bootstrap](https://getbootstrap.com/) and [jQuery](https://jquery.com/).
* The extension is inspired by [alexadam/save-as-ebook](https://github.com/alexadam/save-as-ebook) extension

## License

This browser extension uses GNU General Public License v3.0 license.
