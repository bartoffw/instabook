// Registering this listener when the script is first executed ensures that the
// offscreen document will be able to receive messages when the promise returned
// by `offscreen.createDocument()` resolves.
chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message, sender, sendResponse) {
    // Return early if this message isn't meant for the offscreen document.
    if (message.target !== 'offscreen') {
        return false;
    }

    // Dispatch the message to an appropriate handler.
    switch (message.type) {
        case 'create-epub':
            try {
                const result = await handleEpubCreation(message.data, false);
                // Send the blob data back to background script
                await sendEpubToBackground(result, false);
                sendResponse({success: true});
            } catch (error) {
                console.error('Error creating EPUB:', error);
                sendResponse({ success: false, error: error.message });
            }
            return true;
        case 'create-chapters-epub':
            try {
                const result = await handleEpubCreation(message.data, true);
                // Send the blob data back to background script
                await sendEpubToBackground(result, true);
                sendResponse({ success: true });
            } catch (error) {
                console.error('Error creating chapters EPUB:', error);
                sendResponse({ success: false, error: error.message });
            }
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
            includeComments: msg.includeComments,
            shortenTitles: msg.shortenTitles
        });
        epub.process();
        return await prepareEpubFileOffscreen(epub);
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
            includeComments: msg.includeComments,
            shortenTitles: msg.shortenTitles
        });
        epub.process();
        return await prepareEpubFileOffscreen(epub);
    }
}

async function prepareEpubFileOffscreen(epub) {
    return await epub.prepareEpubFile((imgUrl, isCover) => {
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

async function sendEpubToBackground(epubResult, hasChapters) {
    try {
        // Convert blob to ArrayBuffer for transfer
        const arrayBuffer = await epubResult.blob.arrayBuffer();
        const dataArray = Array.from(new Uint8Array(arrayBuffer));

        // Send the blob data back to background script
        chrome.runtime.sendMessage({
            type: hasChapters ? 'chapters-epub-ready' : 'epub-ready',
            target: 'background',
            data: {
                buffer: dataArray,
                filename: epubResult.fileName,
                size: epubResult.blob.size
            }
        });
    } catch (error) {
        console.error('Error sending EPUB to background:', error);
        throw error;
    }
}
