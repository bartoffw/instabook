browser.runtime.onMessage.addListener(request => {
    if (request.type === 'get') {
        return Promise.resolve(document.documentElement.outerHTML);
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
