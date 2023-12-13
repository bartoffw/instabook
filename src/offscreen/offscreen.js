// Registering this listener when the script is first executed ensures that the
// offscreen document will be able to receive messages when the promise returned
// by `offscreen.createDocument()` resolves.
chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(msg) {
    // Return early if this message isn't meant for the offscreen document.
    if (msg.target !== 'offscreen') {
        return false;
    }

    // Dispatch the message to an appropriate handler.
    switch (msg.type) {
        case 'create-epub':
            const epub = new Epub(
                msg.html, msg.url, msg.iframes, msg.images, msg.currentUrl, msg.originUrl, msg.coverUrl
            );
            epub.process();

            await epub.prepareEpubFile((imgUrl, isCover) => {
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
            break;
        default:
            console.warn(`Unexpected message type received: '${msg.type}'.`);
            return false;
    }
}