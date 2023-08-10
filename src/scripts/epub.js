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

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    #allowedImgExtensions = ['png', 'jpg', 'jpeg', 'gif'];

    constructor(doc, sourceUrl, iframes, images, currentUrl, originUrl, threshold = 500) {
        this.#iframes = iframes;
        this.#images = images;
        this.#docClone = this.processIframes(doc); //.cloneNode(true);
        this.#sourceUrl = sourceUrl;
        this.#currentUrl = currentUrl;
        this.#originUrl = originUrl;
        this.#readability = new Readability(this.#docClone, { charThreshold: threshold });
    }

    check() {
        const content = this.#readability.parse();
        const parsedContent = this.cleanupContent(
            content.content
        );
        return {
            content: parsedContent,
            readTime: this.estimateReadingTime(content.textContent),
            //images: imgUrls
        };
    }

    process() {
        this.#bookId = 'epub-' + (Math.random() * 100000) + (new Date().getTime() / 1000);
        this.#parsedContent = this.#readability.parse();
        this.#bookReadTime = this.estimateReadingTime(this.#parsedContent.textContent);

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
        const iframes = this.iframes;
        $doc.find('iframe').each(function (index, element) {
            url = element.src.replace('moz-extension:', '');
            console.log('iframe: ' + url + ' - ' + ((url in iframes) ? 'YES' : 'NO'));
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
                that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext + '" />');
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
        content = DOMPurify.sanitize(content); //, {PARSER_MEDIA_TYPE: 'application/xhtml+xml'});
        return new XMLSerializer().serializeToString(
            new DOMParser().parseFromString(content, 'text/html')
        );
    }

    stripHtml(content) {
        let div = document.createElement('div');
        div.innerHTML = content;
        return div.textContent || div.innerText || '';
    }

    prepareEpubFile(imageContentPromise) {
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        zip.file('META-INF/container.xml', this.getContainerXml());

        console.log('preparing images');
        const that = this;
        for (let idx = 0; idx < this.imageUrls.length; idx++) {
            const imgUrl = this.imageUrls[idx];
            const ext = that.extractExt(imgUrl);
            zip.file('OEBPS/images/img' + (idx + 1) + '.' + ext, imageContentPromise(that.getAbsoluteUrl(imgUrl), false), { binary: true });
        }
        if (that.#coverImage) {
            console.log('cover: ' + that.#coverImage);
            const ext = that.extractExt(that.#coverImage);
            //zip.file('OEBPS/images/cover.' + ext, this.images[imgUrl].split(',')[1], { base64: true })
            zip.file('OEBPS/images/cover.' + ext, imageContentPromise(that.getAbsoluteUrl(that.#coverImage), true), { binary: true });
            that.#coverPath = 'images/cover.' + ext;
        }
        console.log('finishing');
        zip.file('OEBPS/content.opf', this.getContentOpf());
        zip.file('OEBPS/toc.ncx', this.getTocNcx());
        zip.file('OEBPS/toc.xhtml', this.getTocXhtml());

        zip.file('OEBPS/styles/ebook.css', this.getBookStyles());
        zip.file('OEBPS/pages/title.xhtml', this.getCover());
        zip.file('OEBPS/pages/content.xhtml', this.bookContent);

        zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip'
        }).then((content) => {
            let filename = this.stripHtml(that.#parsedContent.title) + ' (Instabooked).epub';
            saveAs(content, filename.replace(/[/\\?%*:|"<>]/g, ''));
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
        const ext = this.extractExt(this.#coverImage);
        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="book-id" version="3.0">\n' +
            '<metadata>\n' +
            '   <dc:type>Web page</dc:type>\n' +
            '   <dc:title>' + this.stripHtml(this.#parsedContent.title) + '</dc:title>' +
            (this.#parsedContent.byline ?
            '   <dc:creator>' + this.stripHtml(this.#parsedContent.byline) + '</dc:creator>\n' : '') +
            '   <dc:description>Read time: ' + this.#bookReadTime.minutes + ' minutes</dc:description>\n' +
            '   <dc:identifier id="book-id">' + this.#bookId + '</dc:identifier>\n' +
            '   <meta property="dcterms:modified">2022-07-15T23:46:34Z</meta>\n' +
            '   <dc:language>' + this.#bookLanguage + '</dc:language>\n' +
            '   <dc:source>' + this.#sourceUrl + '</dc:source>\n' +
            (this.#coverImage ?
            '   <meta name="cover" content="cover-image"/>' : '') +
            '</metadata>\n' +
            '<manifest>\n' +
            '   <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav" />\n' +
            '   <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n' +
            '   <item id="styles" href="styles/ebook.css" media-type="text/css" />\n' +
            '   <item id="title" href="pages/title.xhtml" media-type="application/xhtml+xml" />\n' +
            '   <item id="content" href="pages/content.xhtml" media-type="application/xhtml+xml" />\n' +
            '   ' + this.#imageItems.join('\n   ') +
            (this.#coverImage ?
            '   <item id="cover-image" href="' + this.#coverPath + '" media-type="image/' + ext + '" />\n' : '') +
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
            '   <text>' + this.stripHtml(this.#parsedContent.title) + '</text>\n' +
            '</docTitle>\n' +
            '<docAuthor>\n' +
            '   <text>' + this.stripHtml(this.#parsedContent.byline) + '</text>\n' +
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
            '           <li><a href="pages/content.xhtml">' + this.stripHtml(this.#parsedContent.title) + '</a></li>\n' +
            '       </ol>\n' +
            '   </nav>\n' +
            '</body>\n' +
            '</html>';
    }

    getCover() {
        const domain = (new URL(this.#sourceUrl)).hostname;
        return '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.#bookLanguage + '" lang="' + this.#bookLanguage + '" >\n' +
            '<head>\n' +
            '   <title>' + this.stripHtml(this.#parsedContent.title) + '</title>\n' +
            '   <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '</head>\n' +
            '<body id="epub-title">\n' +
            /*(this.#coverPath ?
            '   <div class="bg-image" style="background-image: url(../' + this.#coverPath + ')"></div>\n' : '') +*/
            (this.#coverPath ?
            '   <div class="image"><img src="../' + this.#coverPath + '" alt="cover" /></div>\n' : '') +
            '   <div class="text-section">\n' +
            '       <h1>' + this.stripHtml(this.#parsedContent.title) + '</h1>\n' +
            (this.#parsedContent.byline ?
            '       <h2>' + this.stripHtml(this.#parsedContent.byline) + '</h2>\n' : '') +
            '       <h3 dir="ltr">Read time: ' + this.#bookReadTime.minutes + ' minutes</h3>\n' +
            '       <h3>Downloaded from <a href="' + this.#sourceUrl + '">' + domain + '</a></h3>\n' +
            '   </div>\n' +
            '</body>\n' +
            '</html>';
    }

    getBookStyles() {
        return '#logo { display: inline; border: 0; height: 32px; width: 160px; margin: 0 0 2em 0; padding: 0; } ' +
            'body { padding: 0; margin: 1em; font-family: georgia, times new roman, times roman, times, roman, serif } ' +
            //'#epub-title img { border:0; height: auto; width: 100%; } ' +
            'h1 { font-weight: bold; font-size: 1.2em; } ' +
            'h2, h3, h4, h5, h6 { margin: 1.5em 0 1em 0; padding: 0; font-weight: bold; font-size: 1em; } ' +
            'div, p.img, p img { margin: 1em 0; padding: 0; text-align: center; text-indent: 0; } ' +
            'img { text-align: center; min-width: 95%; max-width: 100%; padding: 0; margin: 0 }' +
            'p { margin: 0; text-align: justify; text-indent: 2em; } ' +
            'span.filler { padding-right: 2em; } p.first-child { text-indent: 0; } ' +
            'pre, code, tt, kbd { font-size: 75%; } pre { white-space: pre-wrap; text-align: left; } ' +
            'table { border-collapse: collapse; border-spacing: 0 } table td, table th { padding: 3px; border: 1px solid black; } ' +
            '#disclaimer h1 { margin: 0; padding: 0; } ' +
            '#disclaimer h2 { font-weight: bold; font-size: 1.1em; text-align: center; } ' +
            '#disclaimer { margin-top: 2em; } #disclaimer p, #disclaimer .url { text-indent: 0; margin: 0.5em 0; padding: 0; } ' +
            '#epub-title { position: relative } ' +
            '#epub-title h1, #epub-title h2, #epub-title h3 { margin: 0 1.5em; padding: 1em 1.5em; text-align: center } ' +
            '#epub-title h2, #epub-title h3 { font-weight: normal; font-size: 1.1em; } ' +
            '#epub-title h1 { margin-top: 2em; font-size: 1.7em } ' +
            '#epub-title div { text-align: center } ' +
            '#epub-title .image { padding-top: 0.5em } ' +
            '#epub-title .image, .text-section { position: absolute; top: 0; left: 0; width: 100%; height: 100%; text-align: center } ' +
            '#epub-title .image img { display: inline-block; width: 100%; max-width: 100%; height: auto; } ' +
            '.bg-image { background-position: bottom; background-repeat: no-repeat; background-size: cover } ' +
            '#epub-title h1, #epub-title h2, #epub-title h3 { background-color: rgba(255, 255, 255, 0.6) }';
    }

    estimateReadingTime(plainText, wpm = 200) {
        const totalWords = plainText.trim().split(/\s+/).length;
        return {
            'minutes': Math.floor(totalWords / wpm),
            'seconds': Math.floor(totalWords % wpm / (wpm / 60))
        };
    }

    prepareCoverImage(imageUrl) {
        // from: https://pqina.nl/blog/cropping-images-to-an-aspect-ratio-with-javascript/
        return new Promise((resolve) => {
            const aspectRatio = 0.75; // 4:3 ratio in portrait mode
            const inputImage = new Image();
            inputImage.crossOrigin = 'anonymous';
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
                outputImage.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpg', 0.75);
            };
            inputImage.src = imageUrl;
        });
    }

    extractExt(fileName) {
        let ext = fileName.split('.').pop().toLowerCase();
        if (ext === fileName || ext.length > 4) {
            ext = 'jpg';
        }
        return ext;
    }

    getAbsoluteUrl(urlStr) {
        if (!urlStr) {
            return '';
        }
        if (urlStr.length === 0) {
            return '';
        }
        try {
            urlStr = this.decodeHtmlEntity(urlStr);
            let currentUrl = this.removeEndingSlash(this.#currentUrl);
            let originUrl = this.removeEndingSlash(this.#originUrl);
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
            return 'https://corsproxy.io/?' + encodeURIComponent(absoluteUrl);
        } catch (e) {
            console.log('Error:', e);
            return urlStr;
        }
    }

    decodeHtmlEntity(str) {
        return str.replace(/&#(\d+);/g, function(match, dec) {
            return String.fromCharCode(dec);
        });
    }

    removeEndingSlash(inputStr) {
        if (inputStr.endsWith('/')) {
            return inputStr.substring(0, inputStr.length - 1);
        }
        return inputStr;
    }

    get bookContent() {
        return this.#parsedContent.content;
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
}