browser.runtime.onMessage.addListener((msg, sender, sendRes) => {
    /** Received the Convert/Download action **/
    if (msg.type === 'convert') {
        const epub = new Epub({
            docHTML: msg.html,
            sourceUrl: msg.url,
            iframes: msg.iframes,
            images: msg.images,
            currentUrl: msg.currentUrl,
            defaultCoverUrl: browser.runtime.getURL('assets/cover.jpg'),
            docTitle: msg.title,
            url: msg.url,
            md5: msg.md5,
            author: msg.author,
            readTime: msg.readTime,
            coverImage: msg.coverImage,
            dividerUrl: msg.dividerUrl
        });
        epub.process().then(() => {
            return prepareEpubFile(epub, 'conversion-finished');
        });
    }
    else if (msg.type === 'convert-chapters') {
        const epub = new Epub({
            cover: msg.cover,
            chapters: msg.chapters,
            dividerUrl: msg.dividerUrl
        });
        epub.process().then(() => {
            return prepareEpubFile(epub, 'chapters-conversion-finished');
        });
    }
    /** Received the Reset action (not used currently) **/
    else if (msg.type === 'reset') {
        console.log('Reset msg');
    }
});

function prepareEpubFile(epub, message) {
    return epub.prepareEpubFile((imgUrl, isCover) => {
        return new Promise((resolve, reject) => {
            if (isCover) {
                epub.prepareCoverImage(imgUrl).then(response => {
                    resolve(response);
                });
            } else {
                if (imgUrl.startsWith('data:image')) {
                    resolve(atob(imgUrl.split(';base64,')[1]));
                } else {
                    JSZipUtils.getBinaryContent(imgUrl, function (err, data) {
                        if (err) {
                            reject(err);
                        } else {
                            chrome.runtime.sendMessage({
                                type: message
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
}