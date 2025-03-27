// Registering this listener when the script is first executed ensures that the
// offscreen document will be able to receive messages when the promise returned
// by `offscreen.createDocument()` resolves.
chrome.runtime.onMessage.addListener(handleMessages);

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
        const epub = new Epub({
            cover: msg.cover,
            chapters: msg.chapters,
            dividerUrl: msg.dividerUrl,
            includeComments: msg.includeComments
        });
        epub.process();
        await prepareEpubFile(epub);
        sendToBackground('chapters-conversion-finished');
    } else {
        const epub = new Epub({
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
            dividerUrl: msg.dividerUrl,
            includeComments: msg.includeComments
        });
        epub.process();
        await prepareEpubFile(epub);
        sendToBackground('conversion-finished');
    }
}

async function prepareEpubFile(epub) {
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
        })
    });
}

function sendToBackground(type) {
    chrome.runtime.sendMessage({
        type,
        // target: 'background',
    });
}