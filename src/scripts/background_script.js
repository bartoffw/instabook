browser.runtime.onMessage.addListener((msg, sender, sendRes) => {
    if (msg.type === 'convert') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(msg.html, 'text/html');
        const epub = new Epub(doc, msg.url, msg.iframes, msg.images, msg.currentUrl, msg.originUrl);
        epub.process();

        epub.prepareEpubFile((imgUrl, isCover) => {
            console.log(imgUrl);
            return new Promise((resolve, reject) => {
                if (isCover) {
                    epub.prepareCoverImage(imgUrl).then(response => {
                        resolve(response);
                    });
                } else {
                    JSZipUtils.getBinaryContent(imgUrl, function (err, data) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(data);
                        }
                    });
                }
                /*browser.tabs.query({currentWindow: true, active: true})
                    .then((tabs) => {
                        browser.tabs
                            .sendMessage(tabs[0].id, { type: 'img', url: imgUrl })
                            .then(response => {
                                resolve(response);
                            })
                            .catch(error => {
                                reject(error);
                                console.error('Error on send message: ' + error)
                            });
                    })
                    .catch(error => {
                        console.error('Error on tab query: ' + error)
                    });*/
            })
        });
    }
    else if (msg.type === 'reset') {
        console.log('Reset msg');
    }
});