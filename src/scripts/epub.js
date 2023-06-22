class Epub {
    #readability;
    #docClone;
    #sourceUrl;
    #htmlContent;
    #parsedContent;
    #imageUrls = [];
    #imageTags;
    #imageItems = [];

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    constructor(doc, sourceUrl, threshold = 500) {
        this.#docClone = doc.cloneNode(true);
        this.#sourceUrl = sourceUrl;
        this.#readability = new Readability(this.#docClone, { charThreshold: threshold });
    }

    process() {
        this.#bookId = 'epub-' + (Math.random() * 100000) + (new Date().getTime() / 1000);
        this.#parsedContent = this.#readability.parse();
        this.#bookReadTime = this.estimateReadingTime(this.#parsedContent.textContent);

        console.log('processing images');
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

        this.prepareEpubFile();
    }

    processImages(content) {
        const that = this;
        this.#imageTags = $(content).find('img');
        this.#imageTags.each(function (idx, image) {
            const url = image.src;
            that.#imageUrls.push(url);
            const ext = that.extractExt(url);
            const newName = 'images/img' + (idx + 1) + '.' + ext;
            that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext + '" />');
            content = content.replaceAll(url, '../' + newName);
        });
        return content;
    }

    cleanupContent(content) {
        return DOMPurify.sanitize(content);
    }

    prepareEpubFile() {
        console.log('preparing ZIP');
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        console.log('preparing META');
        var metaInf = zip.folder('META-INF');
        metaInf.file('container.xml', this.getContainerXml());

        console.log('preparing OEBPS');
        var oebps = zip.folder('OEBPS');
        oebps.file('content.opf', this.getContentOpf());
        oebps.file('toc.ncx', this.getTocNcx());
        oebps.file('toc.xhtml', this.getTocXhtml());

        var images = oebps.folder('images'),
            styles = oebps.folder('styles'),
            pages = oebps.folder('pages');

        console.log('preparing images');
        const that = this;
        this.imageUrls.forEach(function (imgUrl, idx) {
            const ext = that.extractExt(imgUrl);
            images.file('img' + (idx + 1) + '.' + ext, $.get(imgUrl));
        });
        console.log('finishing');
        styles.file('ebook.css', this.getBookStyles());
        pages.file('title.xhtml', this.getCover());
        pages.file('content.xhtml', this.bookContent);

        zip.generateAsync({ type: 'blob'}).then(function (content) {
            saveAs(content, 'book-' + that.#bookId + '.epub');
        });
    }

    getContainerXml() {
        return '<?xml version="1.0"?>\n' +
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
            '   <rootfiles>\n' +
            '       <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
            '   </rootfiles>\n' +
            '</container>';
    }

    getContentOpf() {
        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="book-id" version="3.0">\n' +
            '<metadata>\n' +
            '   <dc:type>Web page</dc:type>\n' +
            '   <dc:title>' + this.#parsedContent.title + '</dc:title>' +
            (this.#parsedContent.byline ?
            '   <dc:creator>' + this.#parsedContent.byline + '</dc:creator>\n' : '') +
            '   <dc:description>Read time: ' + this.#bookReadTime.minutes + ' minutes</dc:description>\n' +
            '   <dc:identifier id="book-id">' + this.#bookId + '</dc:identifier>\n' +
            '   <meta property="dcterms:modified">2022-07-15T23:46:34Z</meta>\n' +
            '   <dc:language>' + this.#bookLanguage + '</dc:language>\n' +
            '   <dc:source>' + this.#sourceUrl + '</dc:source>\n' +
            '</metadata>\n' +
            '<manifest>\n' +
            '   <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav" />\n' +
            '   <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n' +
            '   <item id="styles" href="styles/ebook.css" media-type="text/css" />\n' +
            '   <item id="title" href="pages/title.xhtml" media-type="application/xhtml+xml" />\n' +
            '   <item id="content" href="pages/content.xhtml" media-type="application/xhtml+xml" />\n' +
            '   ' + this.#imageItems.join('\n   ') +
            '</manifest>\n' +
            '<spine toc="ncx">\n' +
            '   <itemref idref="title" linear="yes" />\n' +
            '   <itemref idref="content" linear="yes" />\n' +
            '</spine>\n' +
            '<guide>\n' +
            '   <reference type="title-page" title="Title Page" href="pages/title.xhtml"/>\n' +
            '   <reference type="text" title="Content" href="pages/content.xhtml"/>\n' +
            '</guide>\n' +
            '</package>';
    }

    getTocNcx() {
        return '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="' + this.#bookLanguage + '">\n' +
            '<head>\n' +
            '   <meta name="dtb:uid" content="' + this.#bookId + '"/>\n' +
            '   <meta name="dtb:depth" content="1"/>\n' +
            '   <meta name="dtb:totalPageCount" content="0"/>\n' +
            '   <meta name="dtb:maxPageNumber" content="0"/>\n' +
            '</head>\n' +
            '<docTitle>\n' +
            '   <text>' + this.#parsedContent.title + '</text>\n' +
            '</docTitle>\n' +
            '<docAuthor>\n' +
            '   <text>' + this.#parsedContent.byline + '</text>\n' +
            '</docAuthor>\n' +
            '<navMap>\n' +
            '   <navPoint class="title" id="navPoint-titlepage" playOrder="1">\n' +
            '       <navLabel>\n' +
            '           <text>Title</text>\n' +
            '       </navLabel>\n' +
            '       <content src="pages/title.xhtml"/>\n' +
            '   </navPoint>\n' +
            '   <navPoint class="section" id="navPoint-1" playOrder="2">\n' +
            '       <navLabel>\n' +
            '           <text>Content</text>\n' +
            '       </navLabel>\n' +
            '       <content src="pages/content.xhtml"/>\n' +
            '   </navPoint>\n' +
            '</navMap>\n' +
            '</ncx>';
    }

    getTocXhtml() {
        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
            '<head>\n' +
            '   <title>toc.xhtml</title>\n' +
            '<link href="styles/ebook.css" rel="stylesheet" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            '   <nav id="toc" epub:type="toc">\n' +
            '       <h1 class="frontmatter">Table of Contents</h1>\n' +
            '       <ol class="contents">\n' +
            '           <li><a href="pages/content.xhtml">' + this.#parsedContent.title + '</a></li>\n' +
            '       </ol>\n' +
            '   </nav>\n' +
            '</body>\n' +
            '</html>';
    }

    getCover() {
        return '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.#bookLanguage + '" lang="' + this.#bookLanguage + '" >\n' +
            '<head>\n' +
            '   <title>' + this.#parsedContent.title + '</title>\n' +
            '   <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '</head>\n' +
            '<body id="epub-title">\n' +
            '   <h1>' + this.#parsedContent.title + '</h1>\n' +
            '   <h2>' + this.#parsedContent.byline + '</h2>\n' +
            '   <h3 dir="ltr" >Read time: ' + this.#bookReadTime.minutes + ' minutes</h3>\n' +
            '   <h3><a href="' + this.#sourceUrl + '">' + this.#sourceUrl + '</a></h3>\n' +
            '</body>\n' +
            '</html>';
    }

    getBookStyles() {
        return '#logo { display: inline; border: 0; height: 32px; width: 160px; margin: 0 0 2em 0; padding: 0; } body { padding: 0; margin: 1em; font-family: georgia, times new roman, times roman, times, roman, serif; } #epub-title { padding-top: 50px; } #epub-title div { padding-bottom: 50px; margin-bottom: 50px; border-bottom: 2px solid #d5eeab; } #epub-title img { border:0; height: 32px; width: 160px; } h2, h3, h4, h5, h6 { margin: 1.5em 0 1em 0; padding: 0; font-weight: bold; font-size: 1em; } div, p.img, p img { margin: 1em 0; text-align: justify; text-indent: 0; } p img { display: block; max-width: 100%; height: auto; } p { margin: 0; text-align: justify; text-indent: 2em; } span.filler { padding-right: 2em; } p.first-child { text-indent: 0; } #epub-title h2,#epub-title h3,#disclaimer h1 { margin: 0; padding: 0; } #epub-title h1 { margin: 0 0 1em 0; } h1 { font-weight: bold; font-size: 1.2em; } #epub-title h2, #epub-title h3 { font-weight: normal; font-size: 1.1em; } #disclaimer h2 { font-weight: bold; font-size: 1.1em; text-align: center; } #epub-title div, #epub-title h1, #epub-title h2, #epub-title h3 { text-align: center; padding: 0 0.5em; } #epub-title div { margin-top: 1em; } #disclaimer { margin-top: 2em; } #disclaimer p, #disclaimer .url { text-indent: 0; margin: 0.5em 0; padding: 0; } pre, code, tt, kbd { font-size: 75%; } pre { white-space: pre-wrap; text-align: left; }'; // TODO
    }

    estimateReadingTime(plainText, wpm = 200) {
        const totalWords = plainText.trim().split(/\s+/).length;
        return {
            'minutes': Math.floor(totalWords / wpm),
            'seconds': Math.floor(totalWords % wpm / (wpm / 60))
        };
    }

    extractExt(fileName) {
        let ext = fileName.split('.').pop();
        if (ext === fileName) {
            ext = 'png';
        }
        return ext;
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