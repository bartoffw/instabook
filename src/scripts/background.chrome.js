// import * as Module from './browser-polyfill.min.js'
// import Readability from './Readability.js'
// import Epub from './epub.js'


const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    /** Received the Convert/Download action **/
    if (message.type === 'convert') {
        message.coverUrl = chrome.runtime.getURL('assets/cover.jpg');
        return sendMessageToOffscreenDocument('create-epub', message).then(response => {
            sendResponse({ msg: 'received in background!' })
        });
    }
    else if (message.type === 'convert-chapters') {

    }
    else if (message.target === 'background' && message.type === 'epub-prepared') {

    }
    /** Received the Reset action (not used currently) **/
    else if (message.type === 'reset') {
        console.log('Reset msg');
    }
});

async function sendMessageToOffscreenDocument(type, data) {
    // Create an offscreen document if one doesn't exist yet
    if (!(await hasDocument())) {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [ chrome.offscreen.Reason.DOM_PARSER ],
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
    const result = await chrome.runtime.sendMessage({
        type,
        target: 'offscreen',
        data
    });
    chrome.runtime.sendMessage({
        type: 'conversion-finished'
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
