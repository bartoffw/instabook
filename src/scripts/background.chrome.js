// import * as Module from './browser-polyfill.min.js'
// import Readability from './Readability.js'
// import Epub from './epub.js'


const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    sendResponse({ msg: 'received in background!' });
    /** Received the Convert/Download action **/
    if (message.type === 'convert') {
        message.coverUrl = chrome.runtime.getURL('assets/cover.jpg');
        sendMessageToOffscreenDocument('create-epub', message);
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
                reasons: [chrome.offscreen.Reason.DOM_PARSER],
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



// TODO: https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.offscreen-dom
// and: https://developer.chrome.com/docs/extensions/reference/api/offscreen?hl=pl

let creating; // A global promise to avoid concurrency issues
async function setupOffscreenDocument(path) {
    // Check all windows controlled by the service worker to see if one
    // of them is the offscreen document with the given path
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // create offscreen document
    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['DOM_PARSER'],
            justification: 'making an offline copy of the document',
        });
        await creating;
        creating = null;
    }
}