(() => {
    if (window.__instabookInitialized) return;
    window.__instabookInitialized = true;

    let imageList = {};

    // more than that turns the cover carousel into an unusable strip of dots
    const maxCoverCandidates = 12;

    console.log('Welcome to Instabook!');

browser.runtime.onMessage.addListener(request => {
    /** get page data needed to generate the epub file **/
    if (request.type === 'get') {
        // TODO:
        //  - get meta - og:title, og:description
        //  - content validation before downloading:
        //    - check if all images can be loaded
        //    - check the text length

        $('img').each(function() {
            // remove lazy loading for images
            if (this.hasAttribute('data-src') && !this.hasAttribute('src')) {
                $(this).attr('src', $(this).attr('data-src'));
                $(this).removeAttr('data-src');
            }
            if (this.hasAttribute('loading')) {
                $(this).removeAttr('loading');
            }
        });

        return Promise.resolve(getPageData());
    }
    /** UNUSED: get specific image **/
    else if (request.type === 'img') {
        return new Promise((resolve, reject) => {
            //console.log(getAbsoluteUrl(request.url));
            // JSZipUtils.getBinaryContent(getAbsoluteUrl(request.url), function (err, data) {
            //     console.log(err, data);
            //     if (err) {
            //         reject(err);
            //     } else {
            //         resolve(data);
            //         /*if (data.length > 0) {
            //             resolve(data);
            //         } else {
            //             setTimeout(() => {
            //                 JSZipUtils.getBinaryContent(getAbsoluteUrl(request.url), function (err, data) {
            //                     err ? reject(err) : resolve(data);
            //                 });
            //             }, 200);
            //         }*/
            //         /*if (request.url in imageList) {
            //             const imageUrl = getImageViaCanvas(imageList[request.url]);
            //             if (imageUrl.trim().length > 0) {
            //                 fetch(imageUrl).then(res => resolve(res.blob()));
            //             } else {
            //                 resolve('');
            //             }
            //         }*/
            //     }
            // });
            $.get(Epub.getAbsoluteUrl(request.url, getCurrentUrl()), function(content) {
                //console.log(content);
                resolve(content);
            });//.fail((error) => {
            //    reject(error);
            //});
        });
    }
    /** get the ebook cover preview in the popup **/
    else if (request.type === 'preview') {
        const epub = new Epub({
            docHTML: document.documentElement.outerHTML,
            sourceUrl: getCurrentUrl(),
            currentUrl: getCurrentUrl(),
            includeComments: request.includeComments
        });
        let parsedInfo = epub.check();
        // only images big enough to make a decent cover are offered in the popup
        parsedInfo.covers = filterCoverCandidates(parsedInfo.covers, parsedInfo.pageCovers, getCurrentUrl());
        delete parsedInfo.pageCovers;
        parsedInfo.cover = parsedInfo.covers.length > 0 ? parsedInfo.covers[0] : '';
        parsedInfo.image = Epub.getAbsoluteUrl(parsedInfo.cover, getCurrentUrl());
        // try finding embedded iframes
        parsedInfo.iframes = [];
        $(document.documentElement.outerHTML).find('iframe').each(function () {
            if (typeof $(this).attr('src') !== 'undefined' && $(this).attr('src').length > 0) {
                parsedInfo.iframes.push($(this).attr('src'));
            }
        });
        return Promise.resolve(parsedInfo);
        /*images: parsedInfo.images.map((url) => {
            return getAbsoluteUrl(url);
        })*/
    }
});

/**
 * Drops the cover candidates that are too small to be used as a cover image.
 * Sizes are taken from the live document, as the images of the parsed article
 * are never loaded and therefore report no dimensions at all.
 *
 * Candidates coming from the article are kept even when nothing in the document
 * matches them (the og:image usually) - the popup verifies those while loading
 * them into the carousel. The ones found elsewhere on the page are only added
 * when they really are big enough, so that no page furniture sneaks in.
 *
 * @param covers list of image urls found in the article
 * @param pageCovers list of image urls found outside of the article
 * @param currentUrl
 * @returns {string[]}
 */
function filterCoverCandidates(covers, pageCovers, currentUrl) {
    let sizes = {};
    $('img').each(function () {
        if (this.naturalWidth > 0 && this.naturalHeight > 0) {
            const size = { width: this.naturalWidth, height: this.naturalHeight };
            for (const url of [ Epub.getAbsoluteUrl(this.src, currentUrl, false), Epub.biggestImage(this, currentUrl) ]) {
                if (url && !(url in sizes)) {
                    sizes[url] = size;
                }
            }
        }
    });

    let filtered = [];
    const addCandidates = (candidates, keepUnknownSize) => {
        if (!Array.isArray(candidates)) {
            return;
        }
        for (const cover of candidates) {
            if (filtered.length >= maxCoverCandidates) {
                return;
            }
            const url = Epub.getAbsoluteUrl(cover, currentUrl, false);
            if (!url || filtered.includes(url)) {
                continue;
            }
            const size = sizes[url];
            if (typeof size === 'undefined' ? keepUnknownSize :
                (size.width >= Epub.minCoverImageSize && size.height >= Epub.minCoverImageSize)) {
                filtered.push(url);
            }
        }
    };
    addCandidates(covers, true);
    addCandidates(pageCovers, false);
    return filtered;
}

/**
 * Get page data required to generate the complete epub file
 * @returns {{currentUrl: string, images: {}, html: string, iframes: {}}}
 */
function getPageData() {
    const imgElements = document.getElementsByTagName('img'),
        iframeElements = document.getElementsByTagName('iframe'),
        currentUrl = getCurrentUrl();
    let images = {}, iframes = {},
        img = null, iframe = null,
        url = null;

    const ogImage = $('meta[property="og:image"]:eq(0)').length > 0 ? $('meta[property="og:image"]:eq(0)').attr('content') : '';
    if (ogImage.length > 0) {
        images[ogImage] = true;
    }

    for (let i = 0; i < imgElements.length; i++) {
        img = imgElements[i];
        url = new URL($(img).attr('src'), currentUrl);
        url.search = '';
        url.hash = '';
        url = url.href;
        if (!(url in images)) {
            images[url] = true; ///*await*/ getImageViaCanvas(img);
            imageList[url] = img;
        }
    }

    for (let i = 0; i < iframeElements.length; i++) {
        iframe = iframeElements[i];
        url = new URL(Epub.cleanupUrl($(iframe).attr('src')), currentUrl);
        url.search = '';
        url.hash = '';
        url = url.href;
        if (!(url in iframes)) {
            /*const proxyUrl = Epub.getAbsoluteUrl($(iframe).attr('src'), currentUrl);
            $.get(proxyUrl).success(function(content) {
                iframes[url] = content;
            });*/
            iframes[url] = getIframeContent(iframe);
        }
    }

    return {
        html: document.documentElement.outerHTML,
        iframes: iframes,
        images: images,
        currentUrl: currentUrl
    }
}

/*async*/ function getImageViaCanvas(img) {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    img.crossOrigin = "anonymous";
    canvas.width = img.width;
    canvas.height = img.height;
    let content = '';
    try {
        ctx.drawImage(img, 0, 0);
        content = canvas.toDataURL();
    } catch (e) {
        console.log(e);
    }
    return content;
}

/*async*/ function getIframeContent(iframe) {
    return $(iframe).contents().find('body').html();
}

function getCurrentUrl() {
    let url = window.location.href;
    // if (url.indexOf('?') > 0) {
    //     url = window.location.href.split('?')[0];
    // }
    // url = url.substring(0, url.lastIndexOf('/') + 1);
    return url;
}
})();