// import * as Module from './browser-polyfill.min.js'
// import Readability from './Readability.js'
// import Epub from './epub.js'


const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    message.coverUrl = chrome.runtime.getURL('assets/cover.jpg');
    message.dividerUrl = chrome.runtime.getURL('assets/divider.png');

    /** Received the Convert/Download action **/
    if (message.type === 'convert') {
        handleConversion(message)
            .then(result => {
                console.log('Conversion completed:', result);
                sendResponse({ msg: 'received in background!' });
            })
            .catch(error => {
                console.error('Conversion failed:', error);
                sendResponse({ msg: 'conversion failed', error: error.message });
            });
        return true; // Keep message channel open for async response
    }
    else if (message.type === 'convert-chapters') {
        handleChaptersConversion(message)
            .then(result => {
                console.log('Chapters conversion completed:', result);
                sendResponse({ msg: 'received in background!' });
            })
            .catch(error => {
                console.error('Chapters conversion failed:', error);
                sendResponse({ msg: 'conversion failed', error: error.message });
            });
        return true; // Keep message channel open for async response
    }
    else if (message.target === 'background') {
        // messaging back from the offscreen
        //console.log(message);
        // Handle messages from offscreen with blob data
        if (message.type === 'epub-ready') {
            handleEpubDownload(message.data)
                .then(() => {
                    sendResponse({ msg: 'download-started' });
                })
                .catch(error => {
                    console.error('Download failed:', error);
                    sendResponse({ msg: 'download-failed', error: error.message });
                });
            return true;
        }
        sendResponse({ msg: 'conversion-finished !!!'});
    }
    /** Received the Reset action (not used currently) **/
    else if (message.type === 'reset') {
        //console.log('Reset msg');
    }
});

async function handleConversion(message) {
    try {
        await sendMessageToOffscreenDocument('create-epub', message);
        // The actual download will be handled when offscreen sends back the blob
        return { success: true };
    } catch (error) {
        console.error('Error in handleConversion:', error);
        throw error;
    }
}

async function handleChaptersConversion(message) {
    try {
        await sendMessageToOffscreenDocument('create-chapters-epub', message);
        // The actual download will be handled when offscreen sends back the blob
        return { success: true };
    } catch (error) {
        console.error('Error in handleChaptersConversion:', error);
        throw error;
    }
}

async function handleEpubDownload(epubData) {
    try {
        console.log('Background buffer: ', epubData.buffer);

        // Clean up old EPUB data first
        await cleanupOldEpubData();

        // Store the EPUB data in chrome.storage.local
        const storageKey = `epub_${Date.now()}`;
        await chrome.storage.local.set({
            [storageKey]: {
                buffer: epubData.buffer,
                filename: epubData.filename,
                size: epubData.size,
                timestamp: Date.now()
            }
        });

        // Send notification to popup with storage key
        await notifyPopup('epub-ready', {
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
        const result = await chrome.storage.local.get(null);
        const keysToRemove = [];
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

        for (const [key, value] of Object.entries(result)) {
            if (key.startsWith('epub_') && value.timestamp && value.timestamp < fiveMinutesAgo) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log('Cleaned up old EPUB data:', keysToRemove);
        }
    } catch (error) {
        console.error('Error cleaning up old EPUB data:', error);
    }
}

async function notifyPopup(type, data) {
    try {
        // Try to send message to popup directly
        await chrome.runtime.sendMessage({
            target: 'popup',
            type: type,
            data: data
        });
        console.log('Message sent to popup:', type);
    } catch (error) {
        console.log('Popup not available, storing message:', error.message);
        // Popup is not open, store the message for when it opens
        await chrome.storage.local.set({
            pendingMessage: { type, data, timestamp: Date.now() }
        });
    }
}

async function sendMessageToOffscreenDocument(type, data) {
    // Create an offscreen document if one doesn't exist yet
    if (!(await hasDocument())) {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [ chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.BLOBS ],
                justification: 'Making an offline copy of the document'
            });
        } catch (error) {
            if (!error.message.startsWith('Only a single offscreen')) {
                throw error;
            }
        }
    }
    // Now that we have an offscreen document, we can dispatch the
    // message.
    await chrome.runtime.sendMessage({
        type,
        target: 'offscreen',
        data
    });
}

async function closeOffscreenDocument() {
    if (!(await hasDocument())) {
        return;
    }
    await chrome.offscreen.closeDocument();
}

async function hasDocument() {
    // Check all windows controlled by the service worker if one of them is the offscreen document
    // const matchedClients = await clients.matchAll();
    // for (const client of matchedClients) {
    //     if (client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) {
    //         return true;
    //     }
    // }
    // return false;

    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });
    return existingContexts.length > 0;
}
