let imageList = {};

browser.runtime.onMessage.addListener(request => {
    if (request.type === 'get') {
        // TODO:
        //  - get meta - og:title, og:description, og:image (as a cover?)
        //  - content validation before downloading:
        //    - check if all images can be loaded
        //    - check the text length
        //    - maybe show the cover page with image

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

        //return getPageData();
        return Promise.resolve(getPageData());
    }
    else if (request.type === 'url') {

    }
    else if (request.type === 'img') {
        return new Promise((resolve, reject) => {
            console.log(getAbsoluteUrl(request.url));
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
            $.get(getAbsoluteUrl(request.url), function(content) {
                console.log(content);
                resolve(content);
            });//.fail((error) => {
            //    reject(error);
            //});
        });
    }
    else if (request.type === 'images') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(document.documentElement.outerHTML, 'text/html');
        const epub = new Epub(doc, '', {}, {});
        const parsedInfo = epub.check();
        return Promise.resolve({
            cover: $('meta[property="og:image"]:eq(0)').length > 0 ? $('meta[property="og:image"]:eq(0)').attr('content') : '',
            readTime: parsedInfo.readTime,
            /*images: parsedInfo.images.map((url) => {
                return getAbsoluteUrl(url);
            })*/
        });
    }
});

/*async*/ function getPageData() {
    const imgElements = document.getElementsByTagName('img'),
        iframeElements = document.getElementsByTagName('iframe');
    let images = {}, iframes = {},
        img = null, iframe = null,
        url = null;

    const ogImage = $('meta[property="og:image"]:eq(0)').length > 0 ? $('meta[property="og:image"]:eq(0)').attr('content') : '';
    if (ogImage.length > 0) {
        images[ogImage] = true;
    }

    for (let i = 0; i < imgElements.length; i++) {
        img = imgElements[i];
        url = $(img).attr('src');
        if (!(url in images)) {
            images[url] = true; ///*await*/ getImageViaCanvas(img);
            imageList[url] = img;
        }
    }

    for (let i = 0; i < iframeElements.length; i++) {
        iframe = iframeElements[i];
        url = $(iframe).attr('src');
        if (!(url in iframes)) {
            iframes[url] = /*await*/ getIframeContent(iframe);
        }
    }

    return {
        html: document.documentElement.outerHTML,
        iframes: iframes,
        images: images
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

function delay(millisecs) {
    return new Promise(resolve => {
        setTimeout(resolve, millisecs);
    });
}

function getAbsoluteUrl(urlStr) {
    if (!urlStr) {
        return '';
    }
    if (urlStr.length === 0) {
        return '';
    }
    try {
        urlStr = decodeHtmlEntity(urlStr);
        let currentUrl = getCurrentUrl();
        let originUrl = getOriginUrl();
        let absoluteUrl = urlStr;

        originUrl = removeEndingSlash(originUrl)
        currentUrl = removeEndingSlash(currentUrl)

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

function decodeHtmlEntity(str) {
    return str.replace(/&#(\d+);/g, function(match, dec) {
        return String.fromCharCode(dec);
    });
}

function getCurrentUrl() {
    let url = window.location.href;
    if (url.indexOf('?') > 0) {
        url = window.location.href.split('?')[0];
    }
    url = url.substring(0, url.lastIndexOf('/') + 1);
    return url;
}

function getOriginUrl() {
    let originUrl = window.location.origin;
    if (!originUrl) {
        originUrl = window.location.protocol + "//" + window.location.host;
    }
    return originUrl;
}

function removeEndingSlash(inputStr) {
    if (inputStr.endsWith('/')) {
        return inputStr.substring(0, inputStr.length - 1);
    }
    return inputStr;
}