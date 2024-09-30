// Registering this listener when the script is first executed ensures that the
// offscreen document will be able to receive messages when the promise returned
// by `offscreen.createDocument()` resolves.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessages(message).then(sendResponse({ msg: 'Done!' }));
});

async function handleMessages(message) {
    // Return early if this message isn't meant for the offscreen document.
    if (message.target !== 'offscreen') {
        return false;
    }

    // Dispatch the message to an appropriate handler.
    switch (message.type) {
        case 'create-epub':
            //console.log('creating epub');
            await handleEpubCreation(message.data);
            return true;
        default:
            console.warn(`Unexpected message type received: '${message.type}'.`);
            return false;
    }
}

async function handleEpubCreation(msg) {
    const epub = new Epub({
        docHTML: msg.html,
        sourceUrl: msg.url,
        iframes: msg.iframes,
        images: msg.images,
        currentUrl: msg.currentUrl,
        originUrl: msg.originUrl,
        defaultCoverUrl: msg.coverUrl,
        docTitle: msg.title,
        displayTitle: msg.displayTitle
    });
    epub.process().then(() => {
        return epub.prepareEpubFile((imgUrl, isCover) => {
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
    });
}