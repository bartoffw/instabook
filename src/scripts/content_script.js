browser.runtime.onMessage.addListener(request => {
    if (request.type === 'get') {
        let iframes = [];
        // $('iframe').each(function() {
        //     iframes.push($(this).contents());
        // });
        // return Promise.resolve(document.documentElement.outerHTML);
        return Promise.resolve({
            html: document.documentElement.outerHTML,
            iframes: iframes
        });
    }
    else if (request.type === 'img') {
        return new Promise((resolve, reject) => {
            JSZipUtils.getBinaryContent(request.url, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
            /*$.get(request.url)
                .then((content) => {
                    resolve(content);
                })
                .error((error) => {
                    reject(error);
                });*/
        });
    }
});
