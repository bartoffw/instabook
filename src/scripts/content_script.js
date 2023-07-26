browser.runtime.onMessage.addListener(request => {
    if (request.type === 'get') {
        // TODO:
        //  - get meta - og:title, og:description, og:image (as a cover?)
        //  - content validation before downloading:
        //    - check if all images can be loaded
        //    - check the text length
        //    - maybe show the cover page with image

        return Promise.resolve({
            html: document.documentElement.outerHTML,
            iframes: function() {
                let iframes = {}, url = null;
                $('iframe').each(function() {
                    url = $(this).attr('src');
                    if (!(url in iframes)) {
                        iframes[url] = $(this).contents().find('body').html();
                    }
                });
                return iframes;
            }(),
            images: function() {
                let images = {}, url = null;
                $('img').each(function() {
                    url = $(this).attr('src');
                    if (!(url in images)) {
                        images[url] = getImageViaCanvas(this);
                    }
                });
                return images;
            }()
        });
    }
    /*else if (request.type === 'img') {
        return new Promise((resolve, reject) => {
            JSZipUtils.getBinaryContent(request.url, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
            // $.get(request.url)
            //     .then((content) => {
            //         resolve(content);
            //     })
            //     .error((error) => {
            //         reject(error);
            //     });
        });
    }*/
});

function getImageViaCanvas(img) {
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
}