browser.runtime.onMessage.addListener((msg, sender, sendRes) => {
    /** Received the Convert/Download action **/
    if (msg.type === 'convert') {
        const epub = new Epub(
            msg.html, msg.url, msg.iframes, msg.images, msg.currentUrl, msg.originUrl, browser.runtime.getURL('assets/cover.jpg'),
            msg.title, msg.displayTitle
        );
        epub.process().then(() => {
            return epub.prepareEpubFile((imgUrl, isCover) => {
                return new Promise((resolve, reject) => {
                    if (isCover) {
                        epub.prepareCoverImage(imgUrl).then(response => {
                            resolve(response);
                        });
                    } else {
                        if (imgUrl.startsWith('data:image')) {
                            //console.log('data string found!!!');
                            //console.log(urlStr);
                            resolve(atob(imgUrl.split(';base64,')[1]));
                        } else {
                            JSZipUtils.getBinaryContent(imgUrl, function (err, data) {
                                if (err) {
                                    reject(err);
                                } else {
                                    chrome.runtime.sendMessage({
                                        type: 'conversion-finished'
                                    });
                                    resolve(data);
                                }
                            });
                        }
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
        });
    }
    /** Received the Reset action (not used currently) **/
    else if (msg.type === 'reset') {
        console.log('Reset msg');
    }
});