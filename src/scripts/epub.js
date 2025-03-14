class Epub {
    #hasChapters = false;
    #chapters = {};
    #cover = null;
    #singleChapter = {};
    #singleCover = {};
    #dividerUrl = '';

    static mimeTypes = {
        'png': 'png',
        'gif': 'gif',
        'jpeg': 'jpg',
        'tiff': 'tif',
        'vnd.wap.wbmp': 'wbmp',
        'x-icon': 'ico',
        'x-jng': 'jng',
        'x-ms-bmp': 'bmp',
        'svg+xml': 'svg',
        'webp': 'webp'
    };

    // Add more from http://en.wikipedia.org/wiki/List_of_file_signatures
    static fileHeaders = {
        "89504e47": "png",
        "47494638": "gif",
        "ffd8ffe0": "jpg",
        "ffd8ffe1": "jpg",
        "ffd8ffdb": "jpg",
        "ffd8ffe2": "jpg",
        "25504446": "pdf",
        "7b5c7274": "rtf",
        "49492a00": "tif",
        "4d4d002a": "tif",
        "49492b00": "tif",
        "4d4d002b": "tif",
    };

    #bookId;
    #bookLanguage = 'en';
    #bookReadTime = null;

    #allowedImgExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'wbmp', 'jng', 'svg'];
    #titleKey = 'customTitle';

    constructor(options) {
        const optionsKeys = Object.keys(options);
        if (optionsKeys.includes('docHTML')) {
            this.#hasChapters = false;
            const chapterKey = optionsKeys.includes('md5') ? options.md5 : 'abc';
            this.#singleChapter = {
                html: options.docHTML,
                iframes: optionsKeys.includes('iframes') ? options.iframes : {},
                images: optionsKeys.includes('images') ? options.images : {},
                imageUrls: {},
                imageItems: [],
                currentUrl: optionsKeys.includes('currentUrl') ? options.currentUrl : '',
                url: optionsKeys.includes('url') ? options.url : '',
                title: optionsKeys.includes('docTitle') ? options.docTitle : '',
                md5: chapterKey,
                author: optionsKeys.includes('author') ? options.author : '',
                readTime: optionsKeys.includes('readTime') ? options.readTime : 0,
                coverImage: optionsKeys.includes('coverImage') ? options.coverImage : ''
            };
            this.#singleCover = {
                title: this.#singleChapter.title,
                customTitle: optionsKeys.includes('customTitle') ? options.customTitle : '',
                authors: [
                    this.#singleChapter.author
                ],
                sourceUrls: [],
                readTime: this.#singleChapter.readTime,
                coverImages: [],
                selectedCover: null,
                coverImage: '',
                coverPath: ''
            };
            if (optionsKeys.includes('sourceUrl')) {
                this.#singleCover.sourceUrls.push(options.sourceUrl);
            }
            if (optionsKeys.includes('defaultCoverUrl')) {
                this.#singleCover.coverImages.push(options.defaultCoverUrl);
                this.#singleCover.selectedCover = 0;
            }
            if (optionsKeys.includes('coverImage')) {
                this.#singleCover.coverImages.push(options.coverImage);
                this.#singleCover.selectedCover = 1;
            }
            this.#dividerUrl = optionsKeys.includes('dividerUrl') ? options.dividerUrl : '';

            if (this.#singleCover.coverImages.length > 0) {
                this.#singleCover.coverImage = this.#singleCover.selectedCover in this.#singleCover.coverImages ?
                    this.#singleCover.coverImages[this.#singleCover.selectedCover] :
                    this.#singleCover.coverImages[0];
            }

            this.#singleChapter.docClone = this.processIframes(
                (new DOMParser()).parseFromString(this.#singleChapter.html, 'text/html'),
                this.#singleChapter.iframes
            );
            this.#singleChapter.readability =
                new Readability(this.#singleChapter.docClone, { charThreshold: (optionsKeys.includes('threshold') ? optionsKeys.threshold : 500), keepComments: true, debug: true });
            this.#singleChapter.parsedContent = this.#singleChapter.readability.parse();
        } else if (optionsKeys.includes('chapters')) {
            this.#hasChapters = true;
            this.#chapters = options.chapters;
            this.#cover = options.cover;
            this.#dividerUrl = optionsKeys.includes('dividerUrl') ? options.dividerUrl : '';

            if (this.#cover.coverImages.length > 0) {
                this.#cover.coverImage = this.#cover.selectedCover in this.#cover.coverImages ?
                    this.#cover.coverImages[this.#cover.selectedCover] :
                    this.#cover.coverImages[0];
            }

            const chaptersKeys = Object.keys(this.#chapters);
            for (const chapterKey of chaptersKeys) {
                const chapter = this.#chapters[chapterKey];
                this.#chapters[chapterKey].docClone = this.processIframes(
                    (new DOMParser()).parseFromString(chapter.html, 'text/html'),
                    chapter.iframes
                );
                this.#chapters[chapterKey].readability =
                    new Readability(this.#chapters[chapterKey].docClone, { charThreshold: (optionsKeys.includes('threshold') ? optionsKeys.threshold : 500) });
                this.#chapters[chapterKey].parsedContent = this.#chapters[chapterKey].readability.parse();
            }
        }
    }

    check() {
        const details = this.chapterDetails;
        return {
            cover: details.coverUrl,
            image: Epub.getAbsoluteUrl(details.coverUrl, details.currentUrl),
            content: details.parsedContent.content,
            readTime: this.estimateReadingTime(details.content),
            author: Epub.stripHtml(details.parsedContent.byline)
            //images: imgUrls
        };
    }

    prepareContent(parsedContent, chapter, addTitle = false) {
        parsedContent.content = Epub.cleanupContent(
            this.processImages(parsedContent.content, chapter.images, chapter.currentUrl, chapter.md5)
        );
        parsedContent.content = '<?xml version="1.0" encoding="UTF-8" ?>\n' +
            '<!DOCTYPE html>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + parsedContent.lang + '" lang="' + parsedContent.lang + '" >\n' +
            '<head>\n' +
            '  <link rel="stylesheet" href="../styles/ebook.css" type="text/css" />\n' +
            '  <title>' + Epub.stripHtml(
                typeof chapter.cleanTitle !== 'undefined' && chapter.cleanTitle !== '' ?
                    chapter.cleanTitle : chapter.title
            ) + '</title>\n' +
            '</head>\n' +
            '<body>\n' +
            (addTitle ? '  <h2 class="chapter-title">' + Epub.stripHtml(
                typeof chapter.cleanTitle !== 'undefined' && chapter.cleanTitle !== '' ?
                    chapter.cleanTitle : chapter.title
            ) + '</h2>\n' : '') +
            parsedContent.content + '\n' +
            '</body>\n' +
            '</html>';
        return parsedContent;
    }

    zipImages(zip, imageUrls, currentUrl, imageContentPromise) {
        const imageKeys = Object.keys(imageUrls);
        if (imageKeys.length > 0) {
            let imageIndex = 1;
            for (const imageKey of imageKeys) {
                zip.file('OEBPS/' + imageKey, imageContentPromise(Epub.getAbsoluteUrl(imageUrls[imageKey], currentUrl), false), {binary: true});
                imageIndex++;
            }
        }
    }

    process() {
        this.#bookId = 'instabook-' + Epub.generateUuidv4();

        if (this.#hasChapters) {
            this.#bookLanguage = this.firstChapter.parsedContent.lang;

            const chaptersKeys = Object.keys(this.#chapters);
            for (const chapterKey of chaptersKeys) {
                const chapter = this.#chapters[chapterKey];
                this.#chapters[chapterKey].parsedContent = this.prepareContent(chapter.parsedContent, chapter, true);
            }
        } else {
            this.#bookLanguage = this.#singleChapter.parsedContent.lang;
            this.#singleChapter.parsedContent = this.prepareContent(this.#singleChapter.parsedContent, this.#singleChapter);
        }
    }

    async prepareEpubFile(imageContentPromise) {
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');

        zip.file('META-INF/container.xml', this.getContainerXml());

        // handle images
        if (this.coverImage) {
            //zip.file('OEBPS/images/cover.' + ext, this.images[imgUrl].split(',')[1], { base64: true })
            zip.file('OEBPS/images/cover.jpg', imageContentPromise(Epub.getAbsoluteUrl(this.coverImage, this.coverCurrentUrl), true), { binary: true });
            if (this.#hasChapters) {
                this.#cover.coverPath = 'images/cover.jpg';
            } else {
                this.#singleCover.coverPath = 'images/cover.jpg';
            }
        }

        // generate META files
        zip.file('OEBPS/content.opf', this.getContentOpf());
        zip.file('OEBPS/toc.ncx', this.getTocNcx());

        // generate content files
        zip.file('OEBPS/styles/ebook.css', this.getBookStyles());
        zip.file('OEBPS/pages/cover.xhtml', this.getCover());
        zip.file('OEBPS/toc.xhtml', this.getTocXhtml());

        // generate chapter files
        const chaptersKeys = Object.keys(this.#chapters);
        if (this.#hasChapters) {
            if (this.#dividerUrl.length > 0) {
                zip.file('OEBPS/images/divider.png', imageContentPromise(this.#dividerUrl, false), {binary: true});
            }
            let index = 1;
            for (const chapterKey of chaptersKeys) {
                const chapter = this.#chapters[chapterKey];
                zip.file('OEBPS/pages/chapter' + index + '.xhtml', chapter.parsedContent.content);
                this.zipImages(zip, chapter.imageUrls, chapter.currentUrl, imageContentPromise);
                index++;
            }
        } else {
            zip.file('OEBPS/pages/content.xhtml', this.#singleChapter.parsedContent.content);
            this.zipImages(zip, this.#singleChapter.imageUrls, this.#singleChapter.currentUrl, imageContentPromise);
        }

        await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip'
        }).then((content) => {
            let filename = Epub.stripHtml(this.bookTitle) + ' (Instabooked).epub';
            saveAs(content, filename.replace(/[/\\?%*:|"<>]/g, ''));
            //this.saveFile(content, filename.replace(/[/\\?%*:|"<>]/g, ''))
        });
    }

    async saveFile(blob, fileName) {
        const fileStream = streamSaver.createWriteStream(fileName, {
            size: blob.size // Makes the percentage visible in the download
        })

        // One quick alternetive way if you don't want the hole blob.js thing:
        // const readableStream = new Response(
        //   Blob || String || ArrayBuffer || ArrayBufferView
        // ).body
        const readableStream = blob.stream()

        // more optimized pipe version
        // (Safari may have pipeTo but it's useless without the WritableStream)
        if (window.WritableStream && readableStream.pipeTo) {
            return await readableStream.pipeTo(fileStream)
                //.then(() => console.log('done writing'))
        }

        // Write (pipe) manually
        window.writer = fileStream.getWriter()

        const reader = readableStream.getReader()
        const pump = () => reader.read()
            .then(res => res.done
                ? writer.close()
                : writer.write(res.value).then(pump))

        pump()
    }

    processIframes(doc, iframes) {
        let $doc = $(doc), url = null;
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
     * Updates imageUrls and imageItems, returns updated parsed HTML content
     *
     * @param content
     * @param images
     * @param currentUrl
     * @param chapterKey
     * @returns {*}
     */
    processImages(content, images, currentUrl, chapterKey) {
        const that = this;
        const serializer = new XMLSerializer();

        let $content = $('<div />', { html: content });
        let imageIndex = 1;
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
            if (picImage !== null && picImage.length > 0 || $(picture).find('source').length > 0) {
                const url = decodeURIComponent(
                    $(picture).find('source').length > 0 ?
                        $(picture).find('source').first().attr('srcset').split(',')[0] :
                        picImage.attr('src')
                );
                const ext = Epub.extractExt(url);
                const noStretch = picImage !== null && picImage.length > 0 && picImage[0].naturalWidth <= 32 ? 'class="no-stretch"' : '';
                if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                    const newName = `images/img_${chapterKey}_${imageIndex}.${ext}`;
                    const imageItem = '<item id="img_' + chapterKey + '_' + imageIndex + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />';
                    if (that.#hasChapters) {
                        that.#chapters[chapterKey].imageUrls[newName] = url;
                        that.#chapters[chapterKey].imageItems.push(imageItem);
                    } else {
                        that.#singleChapter.imageUrls[newName] = url;
                        that.#singleChapter.imageItems.push(imageItem);
                    }
                    $(picture).replaceWith('<img src="../' + newName + '" alt="' + (picImage !== null && picImage.length > 0 ? $(picImage).attr('alt') : '') + '" ' + noStretch + ' />');
                    imageIndex++;
                } else {
                    $(picture).replaceWith('<img src="' + url + '" alt="' + (picImage !== null && picImage.length > 0 ? $(picImage).attr('alt') : '') + '" ' + noStretch + ' />');
                }
            }
        });
        // <img> tags
        $content.find('img').each(function (idx, image) {
            if ($(image).parent().is('picture')) {
                const picture = $(image).parent();
                const picImage = $(picture).find('img');
                if (picImage !== null && picImage.length > 0 || picture.find('source').length > 0) {
                    const url = decodeURIComponent(
                        !!picture.find ?
                            picture.find('source').first().attr('srcset').split(',')[0] :
                            picImage.attr('src')
                    );
                    const ext = Epub.extractExt(url);
                    const noStretch = picImage !== null && picImage.length > 0 && picImage[0].naturalWidth <= 32 ? 'class="no-stretch"' : '';
                    if (that.#allowedImgExtensions.includes(ext) && (url in images)) {
                        const newName = `images/img_${chapterKey}_${imageIndex}.${ext}`;
                        const imageItem = '<item id="img_' + chapterKey + '_' + imageIndex + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />';
                        if (that.#hasChapters) {
                            that.#chapters[chapterKey].imageUrls[newName] = url;
                            that.#chapters[chapterKey].imageItems.push(imageItem);
                        } else {
                            that.#singleChapter.imageUrls[newName] = url;
                            that.#singleChapter.imageItems.push(imageItem);
                        }
                        $(picture).replaceWith('<img src="../' + newName + '" alt="' + (picImage !== null && picImage.length > 0 ? $(picImage).attr('alt') : '') + '" ' + noStretch + ' />');
                        imageIndex++;
                    } else {
                        $(picture).replaceWith('<img src="' + url + '" alt="' + (picImage !== null && picImage.length > 0 ? $(picImage).attr('alt') : '') + '" ' + noStretch + ' />');
                    }
                }
            } else {
                const url = Epub.biggestImage(image, currentUrl);
                if (url !== null) {
                    const encodedUrl = Epub.getAbsoluteUrl(image.src, currentUrl, false);
                    const ext = Epub.extractExt(url);
                    const noStretch = image.naturalWidth <= 32 ? 'class="no-stretch"' : '';
                    if (that.#allowedImgExtensions.includes(ext) && (encodedUrl in images)) {
                        const newName = `images/img_${chapterKey}_${imageIndex}.${ext}`;
                        const imageItem = '<item id="img_' + chapterKey + '_' + imageIndex + '" href="' + newName + '" media-type="image/' + ext.replace('jpg', 'jpeg') + '" />';
                        if (that.#hasChapters) {
                            that.#chapters[chapterKey].imageUrls[newName] = url;
                            that.#chapters[chapterKey].imageItems.push(imageItem);
                        } else {
                            that.#singleChapter.imageUrls[newName] = url;
                            that.#singleChapter.imageItems.push(imageItem);
                        }
                        $(image).replaceWith('<img src="../' + newName + '" alt="' + $(image).attr('alt') + '" ' + noStretch + ' />');
                        imageIndex++;
                    } else {
                        $(image).replaceWith('<img src="' + $(image).attr('src') + '" alt="' + $(image).attr('alt') + '" ' + noStretch + ' />');
                    }
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
        let items = '', spine = '', guide = '', allImageItems = '';
        if (this.#hasChapters) {
            const chaptersKeys = Object.keys(this.#chapters);
            spine = '   <itemref idref="toc" linear="yes" />\n';
            guide = '   <reference type="text" title="Content" href="pages/chapter1.xhtml"/>\n';
            let index = 1;
            for (const chapterKey of chaptersKeys) {
                items += '   <item id="chapter' + index + '" href="pages/chapter' + index + '.xhtml" media-type="application/xhtml+xml" />\n';
                spine += '   <itemref idref="chapter' + index + '" linear="yes" />\n';
                allImageItems += this.#chapters[chapterKey].imageItems.join('\n   ') + '\n';
                index++;
            }
        } else {
            items = '   <item id="content" href="pages/content.xhtml" media-type="application/xhtml+xml" />\n';
            spine = '   <itemref idref="content" linear="yes" />\n';
            guide = '   <reference type="text" title="Content" href="pages/content.xhtml"/>\n';
            allImageItems += this.#singleChapter.imageItems.join('\n   ') + '\n';
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
            '   <dc:description>Read time: ' + this.bookReadTime + '</dc:description>\n' +
            '   <dc:identifier id="book-id">' + this.#bookId + '</dc:identifier>\n' +
            '   <dc:publisher>Instabook (https://instabook.site)</dc:publisher>\n' +
            '   <meta property="dcterms:modified">2024-10-15T23:46:34Z</meta>\n' + // FIXME - modified date
            '   <dc:language>' + this.bookLanguage + '</dc:language>\n' +
            '   <dc:source>' + this.coverSourceUrls.join(', ') + '</dc:source>\n' +
            '</metadata>\n' +
            '<manifest>\n' +
            '   <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n' +
            '   <item id="styles" href="styles/ebook.css" media-type="text/css" />\n' +
            '   <item id="cover" href="pages/cover.xhtml" media-type="application/xhtml+xml" />\n' +
            '   <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav" />\n' +
            items + '   ' + allImageItems +
            (this.coverImage ?
            '   <item id="cover_img" href="' + this.coverPath + '" media-type="image/jpeg" />\n' : '') +
            (this.#hasChapters && this.#dividerUrl.length > 0 ?
            '   <item id="divider_img" href="images/divider.png" media-type="image/png" />\n' : '') +
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
                    '           <text>' + (
                                    typeof chapter.cleanTitle !== 'undefined' && chapter.cleanTitle !== '' ?
                                        chapter.cleanTitle : chapter.title
                                ) + '</text>\n' +
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
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="' + this.bookLanguage + '">\n' +
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
            let index = 1;
            const chaptersKeys = Object.keys(this.#chapters);
            for (const chapterKey of chaptersKeys) {
                const chapter = this.#chapters[chapterKey];
                chapters.push(
                    '           <li><a href="pages/chapter' + index + '.xhtml">' + Epub.stripHtml(
                    typeof chapter.cleanTitle !== 'undefined' && chapter.cleanTitle !== '' ?
                            chapter.cleanTitle : chapter.title
                    ) + '</a></li>\n'
                );
                index++;
            }
        } else {
            chapters.push(
                '           <li><a href="pages/cover.xhtml">Cover Page</a></li>\n'
            );
            chapters.push(
                '           <li><a href="pages/content.xhtml">' + Epub.stripHtml(this.#singleChapter.title) + '</a></li>\n'
            );
        }

        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
            '<head>\n' +
            '   <title>Table of Contents</title>\n' +
            '<link href="styles/ebook.css" rel="stylesheet" type="text/css" />\n' +
            '</head>\n' +
            '<body>\n' +
            '   <nav id="toc" epub:type="toc">\n' +
            '       <h2 class="chapter-title' + (this.#hasChapters && this.#dividerUrl.length > 0 ? ' with-divider' : '') + '">Table of Contents</h2>\n' +
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
            '<html xmlns="http://www.w3.org/1999/xhtml"  xml:lang="' + this.bookLanguage + '" lang="' + this.bookLanguage + '" >\n' +
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
            'h2.chapter-title { font-variant: small-caps; font-size: 1.2em; margin-bottom: 0.5em; text-align: center; } ' +
            (this.#hasChapters && this.#dividerUrl.length > 0 ?
            'h2.chapter-title.with-divider { width: 100%; padding-bottom: 25px; background-image: url(../images/divider.png); background-position: center bottom; background-repeat: no-repeat; } ' : '') +
            '.toc-divider { width: 100%; max-width: 100%; height: auto; text-align: center; margin: 0 auto; } ' +
            'ol.toc-contents { margin-left: 1em; } ol.toc-contents li { margin-bottom: 0.3em; } ' +
            'p.img, p img { margin: 1em 0; padding: 0; text-indent: 0; max-width: 100%; } ' +
            'p:has(img) { margin: 0; text-align: center; } ' +
            'figure { margin: 1em 0; text-align: center; } ' +
            'img:not(.no-stretch) { min-width: 95%; max-width: 100%; padding: 0; margin: 0 }' +
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

    estimateReadingTime(plainText, wpm = 200, inMinutes = true) {
        const totalWords = plainText.trim().split(/\s+/).length;
        const totalMinutes = Math.floor(totalWords / wpm);
        if (inMinutes) {
            return totalMinutes;
        }
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
                if (that.#hasChapters) {
                    that.#cover.coverImage = that.#cover.coverImages[0];
                } else {
                    that.#singleCover.coverImage = that.#singleCover.coverImages[0];
                }
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
                    ctx, 'Read time: ' + that.bookReadTime, 12, '', 22, coverWidth,
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
            // const blob = await fetch(fileName).then(res => res.blob()).then((blob) => {
            //     return blob;
            // });
            // extBlob =
            const type = fileName.substring(11, fileName.indexOf(';'));
            if (type.length > 0 && type in Epub.mimeTypes) {
                ext = Epub.mimeTypes[type];
            }
        } else {
            ext = fileName.split('.').pop().toLowerCase();
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
            urlStr = urlStr.substring(urlStr.split('/', 2).join('/').length, urlStr.split('/', 3).join('/').length).indexOf('.') > 0 ?
                'https:/' + urlStr.substring(urlStr.split('/', 2).join('/').length) :
                urlStr.substring(urlStr.split('/', 3).join('/').length);
        }
        return urlStr;
    }

    static getAbsoluteUrl(urlStr, currentUrl, addProxy = true, decodeHtml = true) {
        if (!urlStr || urlStr.length === 0) {
            return '';
        }
        if (urlStr.startsWith('data:image')) {
            return urlStr;
        }
        try {
            urlStr = decodeHtml ? Epub.cleanupUrl(Epub.decodeHtmlEntity(urlStr)) : Epub.cleanupUrl(urlStr);
            let absoluteUrl = currentUrl.length === 0 || urlStr.substring(urlStr.split('/', 2).join('/').length, urlStr.split('/', 3).join('/').length).indexOf('.') > 0 ?
                new URL(urlStr).href :
                new URL(urlStr, currentUrl).href;
            return addProxy ?
                Epub.proxyUrl + encodeURIComponent(absoluteUrl) :
                absoluteUrl;
        } catch (e) {
            console.log('Error:', e);
            return urlStr;
        }
    }

    get firstChapter() {
        if (this.#hasChapters) {
            const chaptersKeys = Object.keys(this.#chapters);
            for (const chapterKey of chaptersKeys) {
                return this.#chapters[chapterKey];
            }
        } else {
            return this.#singleChapter;
        }
    }

    get bookTitle() {
        const cover = this.#hasChapters ? this.#cover : this.#singleCover;
        return Epub.stripHtml(cover.customTitle !== null && cover.customTitle.length > 0 ? cover.customTitle : cover.title);
    }

    get bookLanguage() {
        return this.#bookLanguage;
    }

    get bookReadTime() {
        if (this.#bookReadTime === null) {
            if (this.#hasChapters) {
                this.#bookReadTime = Epub.formatTime(this.#cover.readTime);
            } else {
                this.#bookReadTime = Epub.formatTime(this.#singleChapter.readTime);
            }
        }
        return this.#bookReadTime;
    }

    get author() {
        return Epub.stripHtml(this.#hasChapters ? this.#cover.authors.join(', ') : this.#singleCover.authors.join(', '));
    }

    get sourceDomain() {
        const urls = this.#hasChapters ? this.#cover.sourceUrls : this.#singleCover.sourceUrls;
        let domains = [];
        for (const sourceUrl of urls) {
            domains.push((new URL(
                (sourceUrl.indexOf('https://') < 0 ? 'https://' : '') + sourceUrl)
            ).hostname);
        }
        return domains.join(', ');
    }

    get chapterDetails() {
        const chapter = this.firstChapter;
        let content, cleanContent, currentUrl, coverUrl;

        content = chapter.parsedContent.content;
        cleanContent = Epub.cleanupContent(content);
        const ogImg = $(chapter.docClone).find('meta[property="og:image"]:eq(0)');
        const img = $(cleanContent).find('img:eq(0)');
        coverUrl = ogImg.length > 0 ? ogImg.attr('content') : (img.length > 0 ? img.attr('src') : '');
        //img = $(parsedContent).find('img:eq(0)');
        currentUrl = chapter.currentUrl;

        return {
            coverUrl: coverUrl,
            currentUrl: currentUrl,
            content: content,
            parsedContent: chapter.parsedContent
        };
    }

    get coverImage() {
        return this.#hasChapters ? this.#cover.coverImage : this.#singleCover.coverImage;
    }

    get coverPath() {
        return this.#hasChapters ? this.#cover.coverPath : this.#singleCover.coverPath;
    }

    get coverSourceUrls() {
        return this.#hasChapters ? this.#cover.sourceUrls : this.#singleCover.sourceUrls;
    }

    get coverCurrentUrl() {
        if (this.#hasChapters) {
            const chaptersKeys = Object.keys(this.#chapters);
            let currentUrl = '';
            if (this.#cover.selectedCover > 0 && (this.#cover.selectedCover - 1) in chaptersKeys) {
                currentUrl = this.#chapters[chaptersKeys[this.#cover.selectedCover - 1]].currentUrl;
            }
            return currentUrl;
        }
        return this.#singleChapter.currentUrl;
    }

    get chapters() {
        return this.#chapters;
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

    static biggestImage(image, currentUrl) {
        let url,
            srcSet = $(image).attr('srcset');
        if (typeof srcSet !== 'undefined') {
            srcSet = srcSet.trim();
            let biggestImage = image.src,
                largestSize = 1,
                srcSetParts = srcSet.split(',');
            // get the biggest image
            for (const imagePart of srcSetParts) {
                const parts = imagePart.trim().split(' ');
                let size = parseFloat(parts[1]);
                if (size > largestSize) {
                    biggestImage = parts[0];
                    largestSize = size;
                }
            }
            url = decodeURIComponent(biggestImage);
        } else {
            url = decodeURIComponent(image.src);
        }
        return url.length > 0 && (url.indexOf('http') === 0 || url.indexOf('data:image') === 0) ?
            Epub.getAbsoluteUrl(url, currentUrl, false) : null;
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
        if (asObject) {
            return { hours: hours, minutes: timeInMinutes, seconds: 0 };
        } else {
            let result = hours > 0 ? hours + (hours === 1 ? ' hour' : ' hours') : '';
            if (timeInMinutes > 0) {
                result += (result.length > 0 ? ' ' : '') + timeInMinutes + (timeInMinutes === 1 ? ' minute' : ' minutes');
            }
            return result;
        }
    }


    //https://stackoverflow.com/questions/18299806/how-to-check-file-mime-type-with-javascript-before-upload/29672957#29672957
    static getBLOBFileHeader(blob) {
        const fileReader = new FileReader();
        fileReader.onloadend = (e) => {
            const arr = (new Uint8Array(e.target.result)).subarray(0, 4);
            let header = "";
            for (let i = 0; i < arr.length; i++) {
                const s = "0000" + arr[i].toString(16);
                header += s.substring(s.length - 2);
            }
            return header.length > 0 && header in Epub.fileHeaders ? Epub.fileHeaders[header] : null;
        };
        fileReader.readAsArrayBuffer(blob);
    }
}