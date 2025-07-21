# Instabook

Create an Ebook from any web page instantly and beautifully. Now you can build your own Ebook with chapters from multiple pages.

![Instabook conversion](/screenshots/extension-large-horizontal.png)

[Talk with us on Mastodon](https://mastodon.social/@instabook)

## Description

Instabook is a browser extension that makes it easy to convert any web page with content into a stylish and clean Ebook for free.
You can save web pages as EPUB files and read them offline on your computer or Ebook reader.

You also get to preview the cover page of your Ebook before the epub file is generated.

The latest version also allows you to build a multi-chapter Ebook with each chapter being a snapshot of a different page.
Read the *Creating an Ebook with chapters* section for details.

## Installation

To install Instabook, just download and install the latest version of the extension from your browser's extension page.
The extension is also available on its [GitHub page](https://github.com/bartoffw/instabook).

## Usage

To use Instabook, follow these steps:

1. Navigate to the web page you want to convert.
2. Click the Instabook icon in your browser's toolbar.
3. *Optional step:* Additionally, you can change the title of your Ebook by clicking on it and editing it. Once you're done, just hit Enter or click the area around the title.
4. Click "Download".
5. Wait for the conversion and download process to complete.
6. Enjoy!

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

### Availability

The extension is available for most of the modern browsers:

* [Firefox](https://addons.mozilla.org/pl/firefox/addon/instabook/)
* [Chrome, Brave, Vivaldi](https://chromewebstore.google.com/detail/instabook/flabhaeaccijjbjmnchngohnpjiphkhl)
* [Edge](https://microsoftedge.microsoft.com/addons/detail/instabook/dkdkmfokibfehifljhmoedmjbiahibkg)
* Opera - waiting

## Roadmap

- release the extension for mobile (Firefox)
- adding multiple language support for the extension
- adding config page
- customizing the title page in the Ebook (adding a cover image)

## Configuration

There are no configuration options yet, but it's on my roadmap.

## Building the extension

The extension utilizes npm build scripts to use custom build configurations for each supported browser.
Running `npm run build` builds the extension for all browsers. The result is stored in the `src/dist` folder.

Running `npm run clean` cleans the `dist` folder. The dist folder is also cleaned before every build.

The extension can be also zipped and prepared for distribution (uploading to extension stores) using `npm run release`.
This will build one zip file for each standard (Firefox and Chromium).

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
* The extension is inspired by [alexadam/save-as-ebook](https://github.com/alexadam/save-as-ebook) extension

## License

This browser extension uses GNU General Public License v3.0 license.
