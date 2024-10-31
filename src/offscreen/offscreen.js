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
            await handleEpubCreation(message.data, false);
            return true;
        case 'create-chapters-epub':
            await handleEpubCreation(message.data, true);
            return true;
        default:
            console.warn(`Unexpected message type received: '${message.type}'.`);
            return false;
    }
}

async function handleEpubCreation(msg, hasChapters) {
    if (hasChapters) {
        let epub = new Epub({
            cover: msg.cover,
            chapters: msg.chapters,
            dividerUrl: msg.dividerUrl
        });
        epub.process().then(() => {
            return prepareEpubFile(epub, 'conversion-finished');
        });
    } else {
        let epub = new Epub({
            docHTML: msg.html,
            sourceUrl: msg.url,
            iframes: msg.iframes,
            images: msg.images,
            currentUrl: msg.currentUrl,
            defaultCoverUrl: msg.coverUrl,
            docTitle: msg.title,
            url: msg.url,
            md5: msg.md5,
            author: msg.author,
            readTime: msg.readTime,
            coverImage: msg.coverImage,
            dividerUrl: msg.dividerUrl
        });
        epub.process().then(() => {
            return prepareEpubFile(epub, 'chapters-conversion-finished');
        });
    }
}

function prepareEpubFile(epub, message) {
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
                        chrome.runtime.sendMessage({
                            type: message
                        });
                        resolve(data);
                    }
                });
            }
        })
    });
}