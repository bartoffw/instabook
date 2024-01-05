# Instabook

Create an eBook from any web page instantly and beautifully.

![Instabook conversion](/screenshots/screenshot.png)

## Description

Instabook is a browser extension that makes it easy to convert any web page with content into a stylish and clean Ebook for free.
You can save web pages as EPUB files and read them offline on your computer or Ebook reader.
You also get to preview the cover page of your Ebook before the epub file is generated.

## Installation

To install Instabook, just download and install the latest version of the extension from your browser's extension page.
The extension is also available on its [GitHub page](https://github.com/bartoffw/instabook).

## Usage

To use Instabook, follow these steps:

1. Navigate to the web page you want to convert.
2. Click the Instabook icon in your browser's toolbar.
3. Click "Download".
4. Wait for the conversion and download process to complete.
5. Enjoy!

## Roadmap

- allow changing ebook title
- release the extension for other browsers (including mobile)
- adding multiple language support for the extension
- adding config page
- adding and managing chapters in the ebook
- customizing the title page in the ebook (adding a cover image)

## Configuration

There are no configuration options yet, but it's on our roadmap.

## Building the extension

The extension utilizes npm build scripts to use custom build configurations for each supported browser.
Running `npm run build` builds the extension for all browsers. The result is stored in the `src/dist` folder.

Running `npm run clean` cleans the `dist` folder. The dist folder is also cleaned before every build.

## Troubleshooting

No issues reported yet. Please submit any problems you find on the [GitHub page](https://github.com/bartoffw/instabook/issues).

## Contributing

Propositions for new features are welcome. Please submit them on the [GitHub page](https://github.com/bartoffw/instabook/issues).

## Credits

* The extension is utilizing the [Readability](https://github.com/mozilla/readability) library to generate the ebook content.
It's the same library that is used by Mozilla Firefox in the [Firefox Reader View](https://support.mozilla.org/kb/firefox-reader-view-clutter-free-web-pages).
* The extension is inspired by [alexadam/save-as-ebook](https://github.com/alexadam/save-as-ebook) extension

## License

This browser extension uses GNU General Public License v3.0 license.
