browser.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
    /** Received the Convert/Download action **/
    switch (message.type) {
        case 'convert':
            await handleEpubCreation(message, false);
            return true;
        case 'convert-chapters':
            await handleEpubCreation(message, true);
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
            defaultCoverUrl: browser.runtime.getURL('assets/cover.jpg'),
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
                if (imgUrl.startsWith('data:image')) {
                    resolve(atob(imgUrl.split(';base64,')[1]));
                } else {
                    JSZipUtils.getBinaryContent(imgUrl, function (err, data) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(data);
                        }
                    });
                }
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