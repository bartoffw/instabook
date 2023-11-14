class Epub {
    #readability;
    #docClone;
    #sourceUrl;
    #htmlContent;
    #parsedContent;
    #iframes;
    #images;
    #imageUrls = [];
    #imageItems = [];
    #coverImage = null;
    #coverPath = null;
    #currentUrl;
    #originUrl;
    #defaultCoverUrl;

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    #allowedImgExtensions = ['png', 'jpg', 'jpeg', 'gif'];

    constructor(docHTML, sourceUrl = '', iframes = {}, images = {}, currentUrl = '', originUrl = '',
                defaultCoverUrl = '', threshold = 500) {
        this.#iframes = iframes;
        this.#images = images;
        this.#sourceUrl = sourceUrl;
        this.#currentUrl = currentUrl;
        this.#originUrl = originUrl;
        this.#htmlContent = docHTML;
        this.#defaultCoverUrl = defaultCoverUrl;

        const doc = (new DOMParser()).parseFromString(docHTML, 'text/html');
        this.#docClone = this.processIframes(doc); //.cloneNode(true);
        this.#readability = new Readability(this.#docClone, { charThreshold: threshold });
    }

    check() {
        const content = this.#readability.parse();
        const parsedContent = this.cleanupContent(
            content.content
        );
        const ogImg = $(this.#docClone).find('meta[property="og:image"]:eq(0)');
        const img = $(this.#htmlContent).find('img:eq(0)');
        const coverUrl = ogImg.length > 0 ? ogImg.attr('content') : (img.length > 0 ? img.attr('src') : '');
        return {
            cover: coverUrl,
            image: img.length > 0 ? Epub.getAbsoluteUrl(img.attr('src'), this.#currentUrl, this.#originUrl) : '',
            content: parsedContent,
            readTime: this.estimateReadingTime(content.textContent),
            title: this.stripHtml(content.title),
            author: this.stripHtml(content.byline)
            //images: imgUrls
        };
    }

    process() {
        this.#bookId = 'instabook-' + Epub.generateUuidv4();
        this.#parsedContent = this.#readability.parse();
        this.#bookReadTime = this.estimateReadingTime(this.#parsedContent.textContent);
        this.#bookLanguage = this.#parsedContent.lang;

        this.#parsedContent.content = this.cleanupContent(
            this.processImages(
                this.#parsedContent.content
            )
        );

        this.#parsedContent.content = '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.#bookLanguage + '" lang="' + this.#bookLanguage + '" >\n' +
            '<head>\n' +
            '  <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '  <title>' + this.stripHtml(this.#parsedContent.title) + '</title>\n' +
            '</head>\n' +
            '<body>\n' +
            this.#parsedContent.content + '\n' +
            '</body>\n' +
            '</html>';
    }

    processIframes(doc) {
        let $doc = $(doc), url = null;
        const iframes = this.iframes, that = this;
        $doc.find('iframe').each(function (index, element) {
            url = Epub.cleanupUrl(element.src);
            if (url in iframes) {
                $(element).replaceWith('<div style="width:100%;height:auto">' + iframes[url] + '</div>');
            } else {
                $(element).replaceWith('');
            }
        });
        return $doc.get(0);
    }

    processImages(content) {
        const that = this;
        const serializer = new XMLSerializer();
        let $content = $('<div />', { html: content });
        const images = this.images;
        // get cover image
        if (Object.keys(images).length > 0) {
            const firstImage = Object.keys(images)[0];
            if (firstImage.length > 0) {
                that.#coverImage = firstImage;
            }
        }
        // <img> tags
        $content.find('img').each(function (idx, image) {
            const url = decodeURIComponent(image.src.replace('moz-extension:', ''));
            const ext = that.extractExt(url);
            if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                that.#imageUrls.push(url);
                const newName = 'images/img' + (idx + 1) + '.' + ext;
                that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />');
                $(image).replaceWith('<img src="../' + newName + '" alt="' + $(image).attr('alt') + '" />');
            }
        });
        // <svg> tags
        $content.find('svg').each(function (index, elem) {
            let bbox = elem.getBoundingClientRect();
            let newWidth = bbox.width ? bbox.width : '100%';
            let newHeight = bbox.height ? bbox.height : 'auto';
            let svgXml = serializer.serializeToString(elem);
            let imgSrc = 'data:image/svg+xml;base64,' + window.btoa(svgXml);
            $(elem).replaceWith('<img src="' + imgSrc + '" width="'+newWidth+'" height="'+newHeight+'" alt="img" />');
        });
        // <canvas> tags
        $content.find('canvas').each(function (index, elem) {
            try {
                let imgUrl = elem.toDataURL('image/jpg');
                $(elem).replaceWith('<img src="' + imgUrl + '" alt="" />');
            } catch (e) {
                console.log(e);
            }
        });
        // MathML objects
        $content.find('span[id^="MathJax-Element-"]').each(function (index, elem) {
            $(elem).replaceWith('<span>' + elem.getAttribute('data-mathml') + '</span>');
        });
        return $content.html();
    }

    cleanupContent(content) {
        const config = {
            FORBID_TAGS: ['span']
        };
        content = DOMPurify.sanitize(content, config); //, {PARSER_MEDIA_TYPE: 'application/xhtml+xml'});
        return new XMLSerializer().serializeToString(
                new DOMParser().parseFromString(content, 'text/html')
            ).replace('<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>', '')
            .replace('</body></html>', '');
    }

    stripHtml(content) {
        let div = document.createElement('div');
        div.innerHTML = content;
        return div.textContent || div.innerText || '';
    }

    async prepareEpubFile(imageContentPromise) {
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        zip.file('META-INF/container.xml', this.getContainerXml());

        const that = this;
        for (let idx = 0; idx < this.imageUrls.length; idx++) {
            const imgUrl = this.imageUrls[idx];
            const ext = that.extractExt(imgUrl);
            zip.file('OEBPS/images/img' + (idx + 1) + '.' + ext, imageContentPromise(Epub.getAbsoluteUrl(imgUrl, that.#currentUrl, that.#originUrl), false), { binary: true });
        }
        if (that.#coverImage) {
            const ext = that.extractExt(that.#coverImage);
            //zip.file('OEBPS/images/cover.' + ext, this.images[imgUrl].split(',')[1], { base64: true })
            zip.file('OEBPS/images/cover.' + ext, imageContentPromise(Epub.getAbsoluteUrl(that.#coverImage, that.#currentUrl, that.#originUrl), true), { binary: true });
            that.#coverPath = 'images/cover.' + ext;
        }
        zip.file('OEBPS/content.opf', this.getContentOpf());
        zip.file('OEBPS/toc.ncx', this.getTocNcx());
        zip.file('OEBPS/toc.xhtml', this.getTocXhtml());

        zip.file('OEBPS/styles/ebook.css', this.getBookStyles());
        zip.file('OEBPS/pages/cover.xhtml', this.getCover());
        zip.file('OEBPS/pages/content.xhtml', this.bookContent);

        await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip'
        }).then((content) => {
            $('#convert-btn').prop('disabled', false);
            $('#convert-spinner').removeClass('visually-hidden');
            let filename = this.stripHtml(that.#parsedContent.title) + ' (Instabooked).epub';
            saveAs(content, filename.replace(/[/\\?%*:|"<>]/g, ''));
        }, (error) => {
            $('#convert-btn').prop('disabled', false);
            $('#convert-spinner').removeClass('visually-hidden');
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
            '   <meta name="generator" content="Instabook" />\n' +
            (this.#coverImage ?
            '   <meta name="cover" content="cover_img" />\n' : '') +
            '   <dc:type>Web page</dc:type>\n' +
            '   <dc:title>' + this.stripHtml(this.#parsedContent.title) + '</dc:title>' +
            (this.#parsedContent.byline ?
            '   <dc:creator>' + this.stripHtml(this.#parsedContent.byline) + '</dc:creator>\n' : '') +
            '   <dc:description>Read time: ' + this.#bookReadTime.minutes + ' minutes</dc:description>\n' +
            '   <dc:identifier id="book-id">' + this.#bookId + '</dc:identifier>\n' +
            '   <dc:publisher>Instabook (https://instabook.site)</dc:publisher>\n' +
            '   <meta property="dcterms:modified">2022-07-15T23:46:34Z</meta>\n' + // FIXME - modified date
            '   <dc:language>' + this.#bookLanguage + '</dc:language>\n' +
            '   <dc:source>' + this.#sourceUrl + '</dc:source>\n' +
            '</metadata>\n' +
            '<manifest>\n' +
            '   <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n' +
            '   <item id="styles" href="styles/ebook.css" media-type="text/css" />\n' +
            '   <item id="cover" href="pages/cover.xhtml" media-type="application/xhtml+xml" />\n' +
            '   <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav" />\n' +
            '   <item id="content" href="pages/content.xhtml" media-type="application/xhtml+xml" />\n' +
            '   ' + this.#imageItems.join('\n   ') +
            (this.#coverImage ?
            '   <item id="cover_img" href="' + this.#coverPath + '" media-type="image/' + this.extractExt(this.#coverImage).replace('jpg', 'jpeg') + '" />\n' : '') +
            '</manifest>\n' +
            '<spine toc="ncx"' + (this.dirRtl ? ' page-progression-direction="rtl"' : '') + '>\n' +
            '   <itemref idref="cover" linear="yes" />\n' +
            '   <itemref idref="content" linear="yes" />\n' +
            '</spine>\n' +
            '<guide>\n' +
            '   <reference type="cover" title="Cover" href="pages/cover.xhtml"/>\n' +
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
            '   <text>' + this.stripHtml(this.#parsedContent.title) + '</text>\n' +
            '</docTitle>\n' +
            '<docAuthor>\n' +
            '   <text>' + this.stripHtml(this.#parsedContent.byline) + '</text>\n' +
            '</docAuthor>\n' +
            '<navMap>\n' +
            '   <navPoint class="cover" id="navPoint-titlepage" playOrder="1">\n' +
            '       <navLabel>\n' +
            '           <text>Cover</text>\n' +
            '       </navLabel>\n' +
            '       <content src="pages/cover.xhtml"></content>\n' +
            '   </navPoint>\n' +
            '   <navPoint class="text" id="navPoint-1" playOrder="2">\n' +
            '       <navLabel>\n' +
            '           <text>Content</text>\n' +
            '       </navLabel>\n' +
            '       <content src="pages/content.xhtml"></content>\n' +
            '   </navPoint>\n' +
            '</navMap>\n' +
            '</ncx>';
    }

    getTocXhtml() {
        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
            '<head>\n' +
            '   <title>Table of Contents</title>\n' +
            '<link href="styles/ebook.css" rel="stylesheet" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            '   <nav id="toc" epub:type="toc">\n' +
            '       <h1 class="frontmatter">Table of Contents</h1>\n' +
            '       <ol class="contents">\n' +
            '           <li><a href="pages/content.xhtml">' + this.stripHtml(this.#parsedContent.title) + '</a></li>\n' +
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
            '   <title>' + this.stripHtml(this.#parsedContent.title) + '</title>\n' +
            '   <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            (this.#coverPath ?
            '   <div class="cover-image"><img src="../' + this.#coverPath + '" alt="cover" /></div>\n' : '') +
            '</body>\n' +
            '</html>';
    }

    getBookStyles() {
        return '#logo { display: inline; border: 0; height: 32px; width: 160px; margin: 0 0 2em 0; padding: 0; } ' +
            'body { padding: 0; margin: 1em; text-align: left; font-family: georgia, times new roman, times roman, times, roman, serif } ' +
            'div, p { margin: 0.5em 0; text-align: left } ' +
            'ul, ol, li { padding-left: 0.4em; margin-left: 0.2em } ' +
            'li { text-align: left } ' +
            'h1 { font-weight: bold; font-size: 1.2em; } ' +
            'h2, h3, h4, h5, h6 { margin: 1.5em 0 1em 0; padding: 0; font-weight: bold; font-size: 1em; } ' +
            'p.img, p img { margin: 1em 0; padding: 0; text-align: center; text-indent: 0; } ' +
            'img { min-width: 95%; max-width: 100%; padding: 0; margin: 0 }' +
            'span.filler { padding-right: 2em; } p.first-child { text-indent: 0; } ' +
            'pre, code, tt, kbd { font-size: 75%; } pre { white-space: pre-wrap; text-align: left; } ' +
            'table { border-collapse: collapse; border-spacing: 0 } table td, table th { padding: 3px; border: 1px solid black; } ' +
            '#disclaimer h1 { margin: 0; padding: 0; } ' +
            '#disclaimer h2 { font-weight: bold; font-size: 1.1em; text-align: center; } ' +
            '#disclaimer { margin-top: 2em; } #disclaimer p, #disclaimer .url { text-indent: 0; margin: 0.5em 0; padding: 0; } ' +
            '.cover-image, .cover-image, .cover-image img { text-align:center; padding:0; margin:0 } ' +
            '.cover-image img { height: 100%; max-width: 100%; text-align: center } ' +
            '.bg-image { background-position: bottom; background-repeat: no-repeat; background-size: cover }';
    }

    estimateReadingTime(plainText, wpm = 200) {
        const totalWords = plainText.trim().split(/\s+/).length;
        return {
            'minutes': Math.floor(totalWords / wpm),
            'seconds': Math.floor(totalWords % wpm / (wpm / 60))
        };
    }

    /**
     * Prepares the cover image for the epub
     * @param imageUrl
     * @returns {Promise<unknown>}
     */
    prepareCoverImage(imageUrl) {
        const that = this;
        // from: https://pqina.nl/blog/cropping-images-to-an-aspect-ratio-with-javascript/
        return new Promise((resolve) => {
            const aspectRatio = 0.75; // 4:3 ratio in portrait mode
            const inputImage = new Image();
            inputImage.crossOrigin = 'anonymous';
            inputImage.onerror = () => {
                that.#coverImage = that.#defaultCoverUrl;
                imageUrl = that.#coverImage;
                inputImage.src = that.#coverImage;
            };
            inputImage.onload = () => {
                // let's store the width and height of our image
                const inputWidth = inputImage.naturalWidth;
                const inputHeight = inputImage.naturalHeight;

                // get the aspect ratio of the input image
                const inputImageAspectRatio = inputWidth / inputHeight;

                // if it's bigger than our target aspect ratio
                let outputWidth = inputWidth;
                let outputHeight = inputHeight;
                if (inputImageAspectRatio > aspectRatio) {
                    outputWidth = inputHeight * aspectRatio;
                } else if (inputImageAspectRatio < aspectRatio) {
                    outputHeight = inputWidth / aspectRatio;
                }

                // calculate the position to draw the image at
                const outputX = (outputWidth - inputWidth) * 0.5;
                const outputY = (outputHeight - inputHeight) * 0.5;

                // create a canvas that will present the output image
                const outputImage = document.createElement('canvas');

                // set it to the same size as the image
                outputImage.width = outputWidth;
                outputImage.height = outputHeight;

                // draw our image at position 0, 0 on the canvas
                const ctx = outputImage.getContext('2d');
                ctx.drawImage(inputImage, outputX, outputY);

                // add text on the image
                let currentPosY = 0;
                currentPosY = that.drawTitle(
                    ctx, that.bookTitle, 20, 'small-caps bold', 30, outputWidth,
                    outputHeight * 0.05, 'rgba(255, 255, 255, 0.6)'
                );
                if (this.#parsedContent.byline) {
                    currentPosY = that.drawTitle(
                        ctx, this.#parsedContent.byline, 13, 'bold', 23, outputWidth,
                        currentPosY, 'rgba(255, 255, 255, 0.6)'
                    );
                }
                currentPosY = that.drawTitle(
                    ctx, 'Read time: ' + that.bookReadTime + ' minutes', 12, '', 22, outputWidth,
                    currentPosY, 'rgba(255, 255, 255, 0.6)'
                );
                that.drawTitle(
                    ctx, 'Downloaded from ' + that.sourceDomain, 12, '', 22, outputWidth,
                    currentPosY, 'rgba(255, 255, 255, 0.6)'
                );

                // https://stackoverflow.com/questions/57403688/how-can-i-implement-word-wrap-and-carriage-returns-in-canvas-filltext
                // https://stackoverflow.com/questions/49614129/wrap-text-within-rect-without-overflowing-it-fiddle-canvas-html5

                outputImage.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.85);
            };
            inputImage.src = imageUrl;
        });
    }

    drawTitle(context, text, fontSize, fontStyle, lineHeight, bgWidth, startY, bgColor = null) {
        const words = text.split(' '),
            startX = bgWidth / 2,
            maxWidth = 0.9 * bgWidth,
            realStartY = startY, bgMargin = lineHeight / 2;


        // lower y for the text
        startY += fontSize;
        context.font = fontStyle + ' ' + fontSize + 'pt arial';
        let line = '', lines = [], textHeight = 0;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = context.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                lines.push(line);
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        if (line.length > 0) {
            lines.push(line);
        }
        textHeight = lines.length * lineHeight;

        if (bgColor) {
            context.fillStyle = bgColor;
            context.fillRect(0, realStartY, bgWidth, textHeight + bgMargin);
            startY += bgMargin;
        }
        context.fillStyle = 'black';
        context.textAlign = 'center';
        for (let i = 0; i < lines.length; i++) {
            context.fillText(lines[i], startX, startY);
            startY += lineHeight;
        }
        return realStartY + textHeight + bgMargin;
    }

    extractExt(fileName) {
        let ext = fileName.split('.').pop().toLowerCase();
        if (ext === fileName || ext.length > 4) {
            ext = 'jpg';
        }
        return ext;
    }

    static cleanupUrl(urlStr) {
        if (!urlStr || urlStr.length === 0) {
            return '';
        }
        if (urlStr.indexOf('moz-extension://') === 0) {
            urlStr = urlStr.substring(urlStr.indexOf('/', 16) + 1);
        }
        return urlStr;
    }

    static getAbsoluteUrl(urlStr, currentUrl, originUrl, addProxy = true) {
        if (!urlStr || urlStr.length === 0) {
            return '';
        }
        try {
            urlStr = Epub.decodeHtmlEntity(urlStr);
            currentUrl = Epub.removeEndingSlash(currentUrl);
            originUrl = Epub.removeEndingSlash(originUrl);
            let absoluteUrl = urlStr;

            if (urlStr.indexOf('//') === 0) {
                absoluteUrl = window.location.protocol + urlStr;
            } else if (urlStr.indexOf('/') === 0) {
                absoluteUrl = originUrl + urlStr;
            } else if (urlStr.indexOf('#') === 0) {
                absoluteUrl = currentUrl + urlStr;
            } else if (urlStr.indexOf('http') !== 0) {
                absoluteUrl = currentUrl + '/' + urlStr;
            }
            return addProxy ?
                Epub.proxyUrl + encodeURIComponent(absoluteUrl) :
                absoluteUrl;
        } catch (e) {
            console.log('Error:', e);
            return urlStr;
        }
    }

    get bookTitle() {
        return this.stripHtml(this.#parsedContent.title);
    }

    get bookByline() {
        return this.#parsedContent.byline ? this.#parsedContent.byline : null;
    }

    get bookContent() {
        return this.#parsedContent.content;
    }

    get bookReadTime() {
        return this.#bookReadTime.minutes;
    }

    get sourceUrl() {
        return this.#sourceUrl;
    }

    get sourceDomain() {
        return (new URL(this.#sourceUrl)).hostname;
    }

    get images() {
        return this.#images;
    }

    get iframes() {
        return this.#iframes;
    }

    get imageUrls() {
        return this.#imageUrls;
    }

    get dirRtl() {
        return this.#parsedContent.dir === 'rtl';
    }

    static get proxyUrl() {
        return 'https://mri9ed2to8.execute-api.us-east-1.amazonaws.com/dev/cors-proxy?url=';
    }

    static removeEndingSlash(inputStr) {
        if (inputStr.endsWith('/')) {
            return inputStr.substring(0, inputStr.length - 1);
        }
        return inputStr;
    }

    static generateUuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
            .replace(/[xy]/g, function (c) {
                const r = Math.random() * 16 | 0,
                    v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
    }

    static decodeHtmlEntity(str) {
        return str.replace(/&#(\d+);/g, function(match, dec) {
            return String.fromCharCode(dec);
        });
    }

    static delay(millisecs) {
        return new Promise(resolve => {
            setTimeout(resolve, millisecs);
        });
    }
}