browser.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message, sender, sendResponse) {
    /** Received the Convert/Download action **/
    switch (message.type) {
        case 'convert':
            try {
                const result = await handleEpubCreation(message, false);
                await sendEpubToPopup(result, false);
                sendResponse({success: true});
            } catch (error) {
                console.error('Error creating EPUB:', error);
                sendResponse({ success: false, error: error.message });
            }
            return true;
        case 'convert-chapters':
            try {
                const result = await handleEpubCreation(message, true);
                await sendEpubToPopup(result, true);
                sendResponse({success: true});
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
            includeComments: msg.includeComments
        });
        epub.process();
        return await prepareEpubFileBackground(epub);
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
        return await prepareEpubFileBackground(epub);
    }
}

async function sendEpubToPopup(epubResult, hasChapters) {
    try {
        // Convert blob to ArrayBuffer for transfer
        const arrayBuffer = await epubResult.blob.arrayBuffer();
        const data = {
            buffer: Array.from(new Uint8Array(arrayBuffer)),
            filename: epubResult.fileName,
            size: epubResult.blob.size
        };
        await handleEpubDownload(hasChapters ? 'chapters-epub-ready' : 'epub-ready', data);
    } catch (error) {
        console.error('Error sending EPUB to popup:', error);
        throw error;
    }
}

async function prepareEpubFileBackground(epub) {
    return await epub.prepareEpubFile((imgUrl, isCover) => {
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

async function handleEpubDownload(dataType, epubData) {
    try {
        // Clean up old EPUB data first
        await cleanupOldEpubData();

        // Store the EPUB data in storage.local
        const storageKey = `epub_${Date.now()}`;
        await browser.storage.local.set({
            [storageKey]: {
                buffer: epubData.buffer,
                filename: epubData.filename,
                size: epubData.size,
                storageKey: storageKey,
                timestamp: Date.now()
            }
        });

        // Send notification to popup with storage key
        await notifyPopup(dataType, {
            storageKey: storageKey,
            filename: epubData.filename,
            size: epubData.size
        });

        return { success: true };
    } catch (error) {
        console.error('Error in handleEpubDownload:', error);
        throw error;
    }
}

async function cleanupOldEpubData() {
    try {
        const result = await browser.storage.local.get(null);
        const keysToRemove = [];
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

        for (const [key, value] of Object.entries(result)) {
            if (key.startsWith('epub_') && value.timestamp && value.timestamp < fiveMinutesAgo) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await browser.storage.local.remove(keysToRemove);
            console.log('Cleaned up old EPUB data:', keysToRemove);
        }
    } catch (error) {
        console.error('Error cleaning up old EPUB data:', error);
    }
}

async function notifyPopup(type, data) {
    try {
        // Try to send message to popup directly
        await browser.runtime.sendMessage({
            target: 'popup',
            type: type,
            data: data
        });
    } catch (error) {
        console.log('Popup not available');
    }
}
