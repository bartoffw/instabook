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

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    #allowedImgExtensions = ['png', 'jpg', 'jpeg', 'gif'];

    constructor(doc, sourceUrl, iframes, images, threshold = 500) {
        this.#iframes = iframes;
        this.#images = images;
        this.#docClone = this.processIframes(doc); //.cloneNode(true);
        this.#sourceUrl = sourceUrl;
        this.#readability = new Readability(this.#docClone, { charThreshold: threshold });
        console.log('ebook init');
    }

    check() {
        const content = this.#readability.parse();
        const parsedContent = this.cleanupContent(
            content.content
        );
        const $content = $('<div />', { html: parsedContent });
        let imgUrls = [];
        $content.find('img').each((idx, image) => {
            imgUrls.push(image.hasAttribute('data-src') ? image['data-src'] : image.src);
        });
        return {
            content: parsedContent,
            readTime: this.estimateReadingTime(content.textContent),
            images: imgUrls
        };
    }

    process() {
        this.#bookId = 'epub-' + (Math.random() * 100000) + (new Date().getTime() / 1000);
        this.#parsedContent = this.#readability.parse();
        this.#bookReadTime = this.estimateReadingTime(this.#parsedContent.textContent);

        console.log('processing images');
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
            const url = image.src.replace('moz-extension:', '');
            const ext = that.extractExt(url);
            //console.log('image: ' + url + ' with ext: ' + ext + ' - ' + ((url in images) ? 'YES' : 'NO'));
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
        console.log('preparing ZIP');
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        console.log('preparing META');
        zip.file('META-INF/container.xml', this.getContainerXml());

        console.log('preparing OEBPS');
        zip.file('OEBPS/content.opf', this.getContentOpf());
        zip.file('OEBPS/toc.ncx', this.getTocNcx());
        zip.file('OEBPS/toc.xhtml', this.getTocXhtml());

        console.log('preparing images');
        const that = this;
        for (let idx = 0; idx < this.imageUrls.length; idx++) {
            const imgUrl = this.imageUrls[idx];
            const ext = that.extractExt(imgUrl);
            const imgPromise = imageContentPromise(imgUrl);
            //zip.file('OEBPS/images/img' + (idx + 1) + '.' + ext, this.images[imgUrl].split(',')[1], { base64: true });
            zip.file('OEBPS/images/img' + (idx + 1) + '.' + ext, imgPromise);
        }
        // if (that.#coverImage) {
        //     console.log(that.#coverImage);
        //     const ext = that.extractExt(that.#coverImage);
        //     //zip.file('OEBPS/images/cover.' + ext, this.images[imgUrl].split(',')[1], { base64: true })
        //     zip.file('OEBPS/images/cover.' + ext, imageContentPromise(that.#coverImage));
        //     that.#coverPath = '../cover.' + ext;
        // }
        console.log('finishing');
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

    /*getImageViaCanvas(img) {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        img.crossOrigin = "anonymous";
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        let content = '';
        try {
            content = canvas.toDataURL();
        } catch (e) {
            console.log(e);
        }
        return content;
    }*/

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
            '   <dc:title>' + this.stripHtml(this.#parsedContent.title) + '</dc:title>' +
            (this.#parsedContent.byline ?
            '   <dc:creator>' + this.stripHtml(this.#parsedContent.byline) + '</dc:creator>\n' : '') +
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
            '<body id="epub-title" style="display:relative">\n' +
            '   <h1>' + this.stripHtml(this.#parsedContent.title) + '</h1>\n' +
            (this.#parsedContent.byline ?
            '   <h2>' + this.stripHtml(this.#parsedContent.byline) + '</h2>\n' : '') +
            '   <h3 dir="ltr" >Read time: ' + this.#bookReadTime.minutes + ' minutes</h3>\n' +
            '   <h3><a href="' + this.#sourceUrl + '">Downloaded from ' + domain + '</a></h3>\n' +
            (this.#coverPath ?
            //'   <div style="position:absolute;bottom:0;left:0;right:0;top:0;background-image:url(' + this.#coverImage + ');background-size:contain"></div>' : '') +
            '   <img src="' + this.#coverPath + '" style="width:auto;height:auto;text-align:center" alt="cover" />' : '') +
            '</body>\n' +
            '</html>';
    }

    getBookStyles() {
        return '#logo { display: inline; border: 0; height: 32px; width: 160px; margin: 0 0 2em 0; padding: 0; } body { padding: 0; margin: 1em; font-family: georgia, times new roman, times roman, times, roman, serif; } #epub-title { padding-top: 50px; } #epub-title div { padding-bottom: 50px; margin-bottom: 50px; border-bottom: 2px solid #d5eeab; } #epub-title img { border:0; height: 32px; width: 160px; } h2, h3, h4, h5, h6 { margin: 1.5em 0 1em 0; padding: 0; font-weight: bold; font-size: 1em; } div, p.img, p img { margin: 1em 0; text-align: justify; text-indent: 0; } p img { display: block; max-width: 100%; height: auto; } p { margin: 0; text-align: justify; text-indent: 2em; } span.filler { padding-right: 2em; } p.first-child { text-indent: 0; } #epub-title h2,#epub-title h3,#disclaimer h1 { margin: 0; padding: 0; } #epub-title h1 { margin: 0 0 1em 0; } h1 { font-weight: bold; font-size: 1.2em; } #epub-title h2, #epub-title h3 { font-weight: normal; font-size: 1.1em; } #disclaimer h2 { font-weight: bold; font-size: 1.1em; text-align: center; } #epub-title div, #epub-title h1, #epub-title h2, #epub-title h3 { text-align: center; padding: 0 0.5em; } #epub-title div { margin-top: 1em; } #disclaimer { margin-top: 2em; } #disclaimer p, #disclaimer .url { text-indent: 0; margin: 0.5em 0; padding: 0; } pre, code, tt, kbd { font-size: 75%; } pre { white-space: pre-wrap; text-align: left; } table { border-collapse: collapse; border-spacing: 0 } table td, table th { padding: 3px; border: 1px solid black; }'; // TODO
    }

    estimateReadingTime(plainText, wpm = 200) {
        const totalWords = plainText.trim().split(/\s+/).length;
        return {
            'minutes': Math.floor(totalWords / wpm),
            'seconds': Math.floor(totalWords % wpm / (wpm / 60))
        };
    }

    extractExt(fileName) {
        let ext = fileName.split('.').pop().toLowerCase();
        if (ext === fileName || ext.length > 4) {
            ext = 'jpg';
        }
        return ext;
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