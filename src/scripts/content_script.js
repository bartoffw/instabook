let imageList = {};

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
        url = new URL($(img).attr('src'), currentUrl).href;
        if (!(url in images)) {
            images[url] = true; ///*await*/ getImageViaCanvas(img);
            imageList[url] = img;
        }
    }

    for (let i = 0; i < iframeElements.length; i++) {
        iframe = iframeElements[i];
        url = new URL(Epub.cleanupUrl($(iframe).attr('src')), currentUrl).href;
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