class Epub {
    // TODO: all elements are individual to chapter!
    #iframes;
    #images;
    #imageUrls = [];
    #imageItems = [];
    #currentUrl;

    #hasChapters = false;
    #chapters = {};
    #cover = null;

    static mimeTypes = {
        'png': 'png',
        'jpeg': 'jpg',
        'tiff': 'tif',
        'vnd.wap.wbmp': 'wbmp',
        'x-icon': 'ico',
        'x-jng': 'jng',
        'x-ms-bmp': 'bmp',
        'svg+xml': 'svg',
        'webp': 'webp'
    };

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime;

    #allowedImgExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'wbmp', 'jng', 'svg'];
    #titleKey = 'customTitle';

    constructor(options) {
        const optionsKeys = Object.keys(options);
        if (optionsKeys.includes('docHTML')) {
            this.#hasChapters = false;
            const chapterKey = optionsKeys.includes('md5') ? optionsKeys.md5 : '1';
            this.#chapters[chapterKey] = {
                html: optionsKeys.docHTML,
                iframes: optionsKeys.includes('iframes') ? optionsKeys.iframes : {},
                images: optionsKeys.includes('images') ? optionsKeys.images : {},
                currentUrl: optionsKeys.includes('currentUrl') ? optionsKeys.currentUrl : '',
                originUrl: optionsKeys.includes('originUrl') ? optionsKeys.originUrl : '',
                sourceUrl: optionsKeys.includes('sourceUrl') ? optionsKeys.sourceUrl : '',
                url: optionsKeys.includes('url') ? optionsKeys.url : '',
                title: optionsKeys.includes('docTitle') ? optionsKeys.docTitle : '',
                md5: chapterKey,
                author: optionsKeys.includes('author') ? optionsKeys.author : '',
                readTime: optionsKeys.includes('readTime') ? optionsKeys.readTime : '',
                coverImage: optionsKeys.includes('coverImage') ? optionsKeys.coverImage : ''
            };
            this.#cover = {
                title: this.#chapters[chapterKey].title,
                customTitle: '',
                authors: [
                    this.#chapters[chapterKey].author
                ],
                sourceUrls: [
                    this.#chapters[chapterKey].sourceUrl
                ],
                readTime: 0, // TODO
                coverImages: [],
                selectedCover: null,
                coverImage: '',
                coverPath: ''
            };
            if (optionsKeys.includes('defaultCoverUrl')) {
                this.#cover.coverImages.push(optionsKeys.defaultCoverUrl);
                this.#cover.selectedCover = 0;
            }
            if (optionsKeys.includes('coverImage')) {
                this.#cover.coverImages.push(optionsKeys.coverImage);
                this.#cover.selectedCover = this.#cover.coverImages.length - 1;
            }
            // this.#htmlContent = optionsKeys.docHTML;
            // this.#documentTitle = optionsKeys.includes('docTitle') ? optionsKeys.docTitle : '';
        } else if (optionsKeys.includes('chapters')) {
            this.#hasChapters = true;
            this.#chapters = options.chapters;
            this.#cover = options.cover;
        }

        this.#cover.coverImage = this.#cover.selectedCover in this.#cover.coverImages ?
            this.#cover.coverImages[this.#cover.selectedCover] : this.#cover.coverImages[0];

        const chaptersKeys = Object.keys(this.#chapters);
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            this.#chapters[chapterKey].docClone = this.processIframes(
                (new DOMParser()).parseFromString(chapter.html, 'text/html')
            );
            this.#chapters[chapterKey].readability =
                new Readability(this.#chapters[chapterKey].docClone, { charThreshold: (optionsKeys.includes('threshold') ? optionsKeys.threshold : 500) });
        }
    }

    check() {
        const chaptersKeys = Object.keys(this.#chapters);
        let content, parsedContent, img;
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            content = chapter.readability.parse();
            parsedContent = Epub.cleanupContent(
                content.content
            );
            img = typeof this.#cover.coverImages[this.#cover.selectedCover] === 'undefined' ?
                this.#cover.coverImages[0] : this.#cover.coverImages[this.#cover.selectedCover];
            break;
        }
        // const ogImg = $(this.#docClone).find('meta[property="og:image"]:eq(0)');
        // const img = $(this.#htmlContent).find('img:eq(0)');
        // const coverUrl = ogImg.length > 0 ? ogImg.attr('content') : (img.length > 0 ? img.attr('src') : '');
        return {
            cover: img,
            image: Epub.getAbsoluteUrl(img.attr('src'), this.#currentUrl),
            content: parsedContent,
            readTime: this.estimateReadingTime(content.textContent),
            author: Epub.stripHtml(content.byline)
            //images: imgUrls
        };
    }

    async process() {
        this.#bookId = 'instabook-' + Epub.generateUuidv4();
        if (this.#hasChapters) {
            this.#bookReadTime = Epub.formatTime(this.#cover.readTime);
        }

        const chaptersKeys = Object.keys(this.#chapters);
        let bookDataSet = false;
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            let parsedContent = chapter.readability.parse();
            if (!bookDataSet) {
                this.#bookLanguage = parsedContent.lang;
                if (!this.#hasChapters) {
                    this.#bookReadTime = Epub.formatTime(chapter.readTime);
                }
                bookDataSet = true;
            }
            parsedContent.content = Epub.cleanupContent(
                this.processImages(parsedContent.content, chapter.images)
            );
            parsedContent.content = '<?xml version="1.0" encoding="UTF-8" ?>\n' +
                '<!DOCTYPE html>\n' +
                '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + parsedContent.lang + '" lang="' + parsedContent.lang + '" >\n' +
                '<head>\n' +
                '  <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
                '  <title>' + Epub.stripHtml(chapter.title) + '</title>\n' +
                '</head>\n' +
                '<body>\n' +
                parsedContent.content + '\n' +
                '</body>\n' +
                '</html>';
            this.#chapters[chapterKey].parsedContent = parsedContent;
        }
    }

    async prepareEpubFile(imageContentPromise) {
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        zip.file('META-INF/container.xml', this.getContainerXml());

        const that = this;
        // handle images
        for (let idx = 0; idx < this.imageUrls.length; idx++) {
            const imgUrl = this.imageUrls[idx];
            const ext = Epub.extractExt(imgUrl);
            zip.file('OEBPS/images/img' + (idx + 1) + '.' + ext, imageContentPromise(Epub.getAbsoluteUrl(imgUrl, that.#currentUrl), false), { binary: true });
        }
        if (that.coverImage) {
            const ext = Epub.extractExt(that.coverImage);
            //zip.file('OEBPS/images/cover.' + ext, this.images[imgUrl].split(',')[1], { base64: true })
            zip.file('OEBPS/images/cover.' + ext, imageContentPromise(Epub.getAbsoluteUrl(that.coverImage, that.#currentUrl), true), { binary: true });
            that.#cover.coverPath = 'images/cover.' + ext;
        }
        // generate META files
        zip.file('OEBPS/content.opf', this.getContentOpf());
        zip.file('OEBPS/toc.ncx', this.getTocNcx());

        // generate content files
        zip.file('OEBPS/styles/ebook.css', this.getBookStyles());
        zip.file('OEBPS/pages/cover.xhtml', this.getCover());
        zip.file('OEBPS/toc.xhtml', this.getTocXhtml());

        const chaptersKeys = Object.keys(this.#chapters);
        let index = 1;
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            if (this.#hasChapters) {
                zip.file('OEBPS/pages/chapter' + index + '.xhtml', chapter.parsedContent.content);
            } else {
                zip.file('OEBPS/pages/content.xhtml', chapter.parsedContent.content);
            }
            index++;
        }

        await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip'
        }).then((content) => {
            $('#convert-btn').prop('disabled', false);
            $('#convert-spinner').removeClass('visually-hidden');
            let filename = Epub.stripHtml(that.bookTitle) + ' (Instabooked).epub';
            saveAs(content, filename.replace(/[/\\?%*:|"<>]/g, ''));
        }, (error) => {
            $('#convert-btn').prop('disabled', false);
            $('#convert-spinner').removeClass('visually-hidden');
        });
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

    /**
     * Updates #imageUrls and #imageItems, returns updated parsed HTML content
     *
     * @param content
     * @param images
     * @returns {*}
     */
    processImages(content, images) {
        const that = this;
        const serializer = new XMLSerializer();

        let $content = $('<div />', { html: content });
        // get cover image
        /*if (Object.keys(images).length > 0) {
            const firstImage = Object.keys(images)[0];
            if (firstImage.length > 0) {
                that.#coverImage = firstImage;
            }
        } else {
            that.#coverImage = that.#defaultCoverUrl;
        }*/
        // <picture> tags
        $content.find('picture').each(function (idx, picture) {
            const picImage = $(picture).find('img');
            const url = decodeURIComponent(
                !!picture.find ?
                    picture.find('source').first().attr('srcset').split(',')[0] :
                    picImage.attr('src')
            );
            const ext = Epub.extractExt(url);
            if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                that.#imageUrls.push(url);
                const newName = 'images/img' + (idx + 1) + '.' + ext;
                that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />');
                $(picture).replaceWith('<img src="../' + newName + '" alt="' + $(picImage).attr('alt') + '" />');
            } else {
                $(picture).replaceWith('<img src="' + url + '" alt="' + $(picImage).attr('alt') + '" />');
            }
        });
        // <img> tags
        $content.find('img').each(function (idx, image) {
            if ($(image).parent().is('picture')) {
                const picture = $(image).parent();
                const picImage = $(picture).find('img');
                const url = decodeURIComponent(
                    !!picture.find ?
                        picture.find('source').first().attr('srcset').split(',')[0] :
                        picImage.attr('src')
                );
                const ext = Epub.extractExt(url);
                if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                    that.#imageUrls.push(url);
                    const newName = 'images/img' + (idx + 1) + '.' + ext;
                    that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />');
                    $(picture).replaceWith('<img src="../' + newName + '" alt="' + $(picImage).attr('alt') + '" />');
                } else {
                    $(picture).replaceWith('<img src="' + url + '" alt="' + $(picImage).attr('alt') + '" />');
                }
            } else {
                const url = Epub.getAbsoluteUrl(decodeURIComponent(image.src), that.#currentUrl, false);
                const ext = Epub.extractExt(url);
                if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                    that.#imageUrls.push(url);
                    const newName = 'images/img' + (idx + 1) + '.' + ext;
                    that.#imageItems.push('<item id="img' + (idx + 1) + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />');
                    $(image).replaceWith('<img src="../' + newName + '" alt="' + $(image).attr('alt') + '" />');
                } else {
                    $(image).replaceWith('<img src="' + $(image).attr('src') + '" alt="' + $(image).attr('alt') + '" />');
                }
            }
        });
        // <svg> tags
        $content.find('svg').each(function (index, elem) {
            let bbox = elem.getBoundingClientRect();
            let newWidth = bbox.width ? bbox.width : '100%';
            let newHeight = bbox.height ? bbox.height : 'auto';
            let svgXml = serializer.serializeToString(elem);
            let imgSrc = 'data:image/svg+xml;base64,' + window.btoa(svgXml);
            $(elem).replaceWith('<img src="' + imgSrc + '" width="' + newWidth + '" height="' + newHeight + '" alt="img" />');
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

    static cleanupContent(content) {
        const config = {
            FORBID_TAGS: ['span','source']
        };
        content = DOMPurify.sanitize(content, config); //, {PARSER_MEDIA_TYPE: 'application/xhtml+xml'});
        return new XMLSerializer().serializeToString(
                new DOMParser().parseFromString(content, 'text/html')
            ).replace('<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>', '')
            .replace('</body></html>', '');
    }

    static stripHtml(content) {
        let div = document.createElement('div');
        div.innerHTML = content;
        return div.textContent || div.innerText || '';
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
        let items = '', spine = '', guide = '', parsedContent;
        const chaptersKeys = Object.keys(this.#chapters);
        if (this.#hasChapters) {
            spine = '   <itemref idref="toc" linear="yes" />\n';
            guide = '   <reference type="text" title="Content" href="pages/chapter1.xhtml"/>\n';
            let index = 1;
            for (const chapterKey of chaptersKeys) {
                items += '   <item id="chapter' + index + '" href="pages/chapter' + index + '.xhtml" media-type="application/xhtml+xml" />\n';
                spine += '   <itemref idref="chapter' + index + '" linear="yes" />\n';
                index++;
            }
        } else {
            items = '   <item id="content" href="pages/content.xhtml" media-type="application/xhtml+xml" />\n';
            spine = '   <itemref idref="content" linear="yes" />\n';
            guide = '   <reference type="text" title="Content" href="pages/content.xhtml"/>\n';
        }

        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="book-id" version="3.0">\n' +
            '<metadata>\n' +
            '   <meta name="generator" content="Instabook" />\n' +
            (this.coverImage ?
            '   <meta name="cover" content="cover_img" />\n' : '') +
            '   <dc:type>Web page</dc:type>\n' +
            '   <dc:title>' + this.bookTitle + '</dc:title>' +
            (this.author.length > 0 ?
            '   <dc:creator>' + this.author + '</dc:creator>\n' : '') +
            '   <dc:description>Read time: ' + this.bookReadTime + ' minutes</dc:description>\n' +
            '   <dc:identifier id="book-id">' + this.#bookId + '</dc:identifier>\n' +
            '   <dc:publisher>Instabook (https://instabook.site)</dc:publisher>\n' +
            '   <meta property="dcterms:modified">2022-07-15T23:46:34Z</meta>\n' + // FIXME - modified date
            '   <dc:language>' + this.#bookLanguage + '</dc:language>\n' +
            '   <dc:source>' + this.#cover.sourceUrls.join(', ') + '</dc:source>\n' +
            '</metadata>\n' +
            '<manifest>\n' +
            '   <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n' +
            '   <item id="styles" href="styles/ebook.css" media-type="text/css" />\n' +
            '   <item id="cover" href="pages/cover.xhtml" media-type="application/xhtml+xml" />\n' +
            '   <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav" />\n' +
            items +
            '   ' + this.#imageItems.join('\n   ') +
            (this.coverImage ?
            '   <item id="cover_img" href="' + this.coverPath + '" media-type="image/' + Epub.extractExt(this.coverImage).replace('jpg', 'jpeg') + '" />\n' : '') +
            '</manifest>\n' +
            '<spine toc="ncx"' + (this.dirRtl ? ' page-progression-direction="rtl"' : '') + '>\n' +
            '   <itemref idref="cover" linear="yes" />\n' +
            spine +
            '</spine>\n' +
            '<guide>\n' +
            '   <reference type="cover" title="Cover" href="pages/cover.xhtml"/>\n' +
            guide +
            '</guide>\n' +
            '</package>';
    }

    getTocNcx() {
        let chapters = '';
        if (this.#hasChapters) {
            chapters +=
                '   <navPoint class="text" id="navPoint-1" playOrder="2">\n' +
                '       <navLabel>\n' +
                '           <text>Table of Contents</text>\n' +
                '       </navLabel>\n' +
                '       <content src="toc.xhtml"></content>\n' +
                '   </navPoint>\n';
            const chaptersKeys = Object.keys(this.#chapters);
            let index = 1;
            for (const chapterKey of chaptersKeys) {
                const chapter = this.#chapters[chapterKey];
                chapters +=
                    '   <navPoint class="text" id="navPoint-' + (index + 1) + '" playOrder="' + (index + 2) + '">\n' +
                    '       <navLabel>\n' +
                    '           <text>' + chapter.title + '</text>\n' +
                    '       </navLabel>\n' +
                    '       <content src="pages/chapter' + index + '.xhtml"></content>\n' +
                    '   </navPoint>\n';
                index++;
            }
        } else {
            chapters =
                '   <navPoint class="text" id="navPoint-1" playOrder="2">\n' +
                '       <navLabel>\n' +
                '           <text>Content</text>\n' +
                '       </navLabel>\n' +
                '       <content src="pages/content.xhtml"></content>\n' +
                '   </navPoint>\n';
        }

        return '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="' + this.#bookLanguage + '">\n' +
            '<head>\n' +
            '   <meta name="dtb:uid" content="' + this.#bookId + '"/>\n' +
            '   <meta name="dtb:depth" content="1"/>\n' +
            '   <meta name="dtb:totalPageCount" content="0"/>\n' +
            '   <meta name="dtb:maxPageNumber" content="0"/>\n' +
            '</head>\n' +
            '<docTitle>\n' +
            '   <text>' + this.bookTitle + '</text>\n' +
            '</docTitle>\n' +
            '<docAuthor>\n' +
            '   <text>' + this.author + '</text>\n' +
            '</docAuthor>\n' +
            '<navMap>\n' +
            '   <navPoint class="cover" id="navPoint-titlepage" playOrder="1">\n' +
            '       <navLabel>\n' +
            '           <text>Cover</text>\n' +
            '       </navLabel>\n' +
            '       <content src="pages/cover.xhtml"></content>\n' +
            '   </navPoint>\n' +
            chapters +
            '</navMap>\n' +
            '</ncx>';
    }

    getTocXhtml() {
        let chapters = [];
        if (this.#hasChapters) {
            chapters.push(
                '           <li><a href="pages/cover.xhtml">Cover Page</a></li>\n' +
                '           <li><a href="toc.xhtml">Table of Contents</a></li>\n'
            );
        } else {
            chapters.push(
                '           <li><a href="pages/cover.xhtml">Cover Page</a></li>\n'
            );
        }
        const chaptersKeys = Object.keys(this.#chapters);
        let index = 1;
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            if (this.#hasChapters) {
                chapters.push(
                    '           <li><a href="pages/chapter' + index + '.xhtml">' + Epub.stripHtml(chapter.title) + '</a></li>\n'
                );
            } else {
                chapters.push(
                    '           <li><a href="pages/content.xhtml">' + Epub.stripHtml(chapter.title) + '</a></li>\n'
                );
            }
            index++;
        }

        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
            '<head>\n' +
            '   <title>Table of Contents</title>\n' +
            '<link href="styles/ebook.css" rel="stylesheet" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            '   <nav id="toc" epub:type="toc">\n' +
            '       <h1 class="frontmatter">Table of Contents</h1>\n' +
            '       <ol class="toc-contents">\n' +
            chapters.join('') +
            '       </ol>' +
            '   </nav>\n' +
            '</body>\n' +
            '</html>';
    }

    getCover() {
        return '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.#bookLanguage + '" lang="' + this.#bookLanguage + '" >\n' +
            '<head>\n' +
            '   <title>' + this.bookTitle + '</title>\n' +
            '   <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            (this.coverPath ?
            '   <div class="cover-image"><img src="../' + this.coverPath + '" alt="cover" /></div>\n' : '') +
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
        const totalMinutes = Math.floor(totalWords / wpm);
        const hours = totalMinutes >= 60 ? Math.floor(totalMinutes / 60) : 0;
        return {
            'hours': hours,
            'minutes': totalMinutes - hours * 60,
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
            const coverHeight = 568;
            const coverWidth = 426;

            const inputImage = new Image();
            inputImage.crossOrigin = 'anonymous';
            inputImage.onerror = () => {
                that.#cover.coverImage = that.#cover.coverImages[0];
                imageUrl = that.coverImage;
                inputImage.src = that.coverImage;
            };
            inputImage.onload = () => {
                // let's store the width and height of our image
                const inputWidth = inputImage.naturalWidth;
                const inputHeight = inputImage.naturalHeight;

                // get the aspect ratio of the input image
                const inputImageAspectRatio = inputWidth / inputHeight;

                let croppedWidth = inputWidth;
                let croppedHeight = inputHeight;
                // if it's bigger than our target aspect ratio
                if (inputImageAspectRatio > aspectRatio) {
                    croppedWidth = inputHeight * aspectRatio;
                } else if (inputImageAspectRatio < aspectRatio) {
                    croppedHeight = inputWidth / aspectRatio;
                }
                const inputX = (inputWidth - croppedWidth) * 0.5;
                const inputY = (inputHeight - croppedHeight) * 0.5;

                // create a canvas that will present the output image
                const outputImage = document.createElement('canvas');

                // set it to the same size as the cover image
                outputImage.width = coverWidth;
                outputImage.height = coverHeight;

                // draw our image at position 0, 0 on the canvas
                const ctx = outputImage.getContext('2d');
                ctx.drawImage(inputImage,
                    inputX, inputY, croppedWidth, croppedHeight,
                    0, 0, coverWidth, coverHeight);

                // add text on the image
                let currentPosY = 0;
                currentPosY = that.drawTitle(
                    ctx, that.bookTitle, 20, 'small-caps bold', 30, coverWidth,
                    coverHeight * 0.05, 'rgba(255, 255, 255, 0.6)'
                );
                if (this.author.length > 0) {
                    currentPosY = that.drawTitle(
                        ctx, this.author, 13, 'bold', 23, coverWidth,
                        currentPosY, 'rgba(255, 255, 255, 0.6)'
                    );
                }
                currentPosY = that.drawTitle(
                    ctx, 'Read time: ' + that.bookReadTime + ' minutes', 12, '', 22, coverWidth,
                    currentPosY, 'rgba(255, 255, 255, 0.6)'
                );
                that.drawTitle(
                    ctx, 'Downloaded from ' + that.sourceDomain, 12, '', 22, coverWidth,
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

    static extractExt(fileName) {
        let ext = 'jpg';
        if (fileName.startsWith('data:image')) {
            const type = fileName.substring(11, fileName.indexOf(';'));
            if (type.length > 0 && type in Epub.mimeTypes) {
                ext = Epub.mimeTypes[type];
            }
        } else {
            let ext = fileName.split('.').pop().toLowerCase();
            if (ext === fileName || ext.length > 4) {
                ext = 'jpg';
            }
        }
        return ext;
    }

    static cleanupUrl(urlStr) {
        if (!urlStr || urlStr.length === 0) {
            return '';
        }
        if (urlStr.startsWith('moz-extension:') || urlStr.startsWith('chrome-extension:')) {
            urlStr = urlStr.substring(urlStr.split('/', 3).join('/').length);
        }
        return urlStr;
    }

    static getAbsoluteUrl(urlStr, currentUrl, addProxy = true) {
        if (!urlStr || urlStr.length === 0) {
            return '';
        }
        if (urlStr.startsWith('data:image')) {
            return urlStr;
        }
        try {
            urlStr = Epub.cleanupUrl(Epub.decodeHtmlEntity(urlStr));
            let absoluteUrl = new URL(urlStr, currentUrl).href;
            return addProxy ?
                Epub.proxyUrl + encodeURIComponent(absoluteUrl) :
                absoluteUrl;
        } catch (e) {
            console.log('Error:', e);
            return urlStr;
        }
    }

    get bookTitle() {
        return Epub.stripHtml(this.#cover.title);
    }

    get bookReadTime() {
        return this.#bookReadTime.minutes;
    }

    get author() {
        return Epub.stripHtml(this.#cover.authors.join(', '));
    }

    get sourceDomain() {
        let domains = [];
        for (const sourceUrl of this.#cover.sourceUrls) {
            domains.push((new URL(sourceUrl)).hostname);
        }
        return domains.join(', ');
    }

    get coverImage() {
        return this.#cover.coverImage;
    }

    get coverPath() {
        return this.#cover.coverPath;
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

    get currentUrl() {
        const chaptersKeys = Object.keys(this.#chapters);
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            if (chapter.parsedContent.dir === 'rtl') {
                isRtl = true;
                break;
            }
        }
    }

    get dirRtl() {
        let isRtl = false;
        const chaptersKeys = Object.keys(this.#chapters);
        for (const chapterKey of chaptersKeys) {
            const chapter = this.#chapters[chapterKey];
            if (chapter.parsedContent.dir === 'rtl') {
                isRtl = true;
                break;
            }
        }
        return isRtl;
    }

    static get proxyUrl() {
        return 'https://images.instabook.site/cors-proxy.php?url=';
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

    static formatTime(timeInMinutes, asObject = false) {
        const hours = Math.floor(timeInMinutes / 60);
        timeInMinutes -= hours * 60;
        return asObject ?
            { hours: hours, minutes: timeInMinutes, seconds: 0 } :
            (hours > 0 ? hours + ' hours ' : '') + timeInMinutes;
    }
}