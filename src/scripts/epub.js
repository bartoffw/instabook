class Epub {
    #readability;
    #docClone;
    #htmlContent;
    #parsedContent;
    #imageUrls = [];
    #imageTags;
    #imageItems = [];

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    constructor(doc, threshold = 500) {
        this.#docClone = doc.cloneNode(true);
        this.#readability = new Readability(this.#docClone, { charThreshold: threshold });
    }

    process() {
        this.#bookId = 'epub-' + (Math.random() * 100000) + (new Date().getTime() / 1000);
        this.#parsedContent = this.#readability.parse();
        this.#bookReadTime = this.estimateReadingTime(this.#parsedContent.textContent);

        this.#parsedContent.content = this.cleanupContent(
            this.processImages(this.#parsedContent.content)
        );

        this.#parsedContent.content = '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.#bookLanguage + '" lang="' + this.#bookLanguage + '" >\n' +
            '<head>\n' +
            '  <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '  <title>' + this.#parsedContent.title + '</title>\n' +
            '</head>\n' +
            '<body>\n' +
            this.#parsedContent.content + '\n' +
            '</body>\n' +
            '</html>';
    }

    processImages(content) {
        const that = this;
        this.#imageTags = $(content).find('img');
        this.#imageTags.each(function (idx, image) {
            const url = image.src;
            that.#imageUrls.push(url);
            const ext = url.split('.').pop();
            if (ext !== url) {
                const newName = 'images/img' + (idx + 1) + '.' + ext;
                that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext + '" />');
                content = content.replaceAll(url, '../' + newName);
            }
        });
        return content;
    }

    cleanupContent(content) {
        return DOMPurify.sanitize(content);
    }

    getBookStyles()
    {
        return '#logo { display: inline; border: 0; height: 32px; width: 160px; margin: 0 0 2em 0; padding: 0; } body { padding: 0; margin: 1em; font-family: georgia, times new roman, times roman, times, roman, serif; } #epub-title { padding-top: 50px; } #epub-title div { padding-bottom: 50px; margin-bottom: 50px; border-bottom: 2px solid #d5eeab; } #epub-title img { border:0; height: 32px; width: 160px; } h2, h3, h4, h5, h6 { margin: 1.5em 0 1em 0; padding: 0; font-weight: bold; font-size: 1em; } div, p.img, p img { margin: 1em 0; text-align: justify; text-indent: 0; } p img { display: block; max-width: 100%; height: auto; } p { margin: 0; text-align: justify; text-indent: 2em; } span.filler { padding-right: 2em; } p.first-child { text-indent: 0; } #epub-title h2,#epub-title h3,#disclaimer h1 { margin: 0; padding: 0; } #epub-title h1 { margin: 0 0 1em 0; } h1 { font-weight: bold; font-size: 1.2em; } #epub-title h2, #epub-title h3 { font-weight: normal; font-size: 1.1em; } #disclaimer h2 { font-weight: bold; font-size: 1.1em; text-align: center; } #epub-title div, #epub-title h1, #epub-title h2, #epub-title h3 { text-align: center; padding: 0 0.5em; } #epub-title div { margin-top: 1em; } #disclaimer { margin-top: 2em; } #disclaimer p, #disclaimer .url { text-indent: 0; margin: 0.5em 0; padding: 0; } pre, code, tt, kbd { font-size: 75%; } pre { white-space: pre-wrap; text-align: left; }'; // TODO
    }

    estimateReadingTime(plainText, wpm = 200) {
        const totalWords = plainText.trim().split(/\s+/).length;
        return {
            'minutes': Math.floor(totalWords / wpm),
            'seconds': Math.floor(totalWords % wpm / (wpm / 60))
        };
    }

    get bookContent() {
        return this.#parsedContent.content;
    }

    get imageTags() {
        return this.#imageTags;
    }

    get imageUrls() {
        return this.#imageUrls;
    }
}