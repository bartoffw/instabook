// import * as Module from './browser-polyfill.min.js'
// import Readability from './Readability.js'
// import Epub from './epub.js'

// importScripts(
//     "browser-polyfill.min.js",
//     //"jquery.min.js",
//     "jszip-utils.min.js",
//     "purify.js",
//     "Readability.js",
//     "epub.js"//,
//     //"content_script.js"
// );

importScripts("browser-polyfill.min.js");

const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

chrome.action.onClicked.addListener((tab) => {
    if (!tab.url.includes('chrome://')) {
        chrome.action.setPopup({ popup: 'action/popup.html' });
        browser.browserAction.openPopup();
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
                "scripts/browser-polyfill.min.js",
                "scripts/jquery.min.js",
                "scripts/jszip-utils.min.js",
                "scripts/purify.js",
                "scripts/Readability.js",
                "scripts/epub.js",
                'scripts/content_script.js'
            ]
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'preview') {
        // return sendMessageToOffscreenDocument('preview-epub', message).then(response => {
        //     sendResponse({ msg: 'received in background!' })
        // });
        // const epub = new Epub(
        //     document.documentElement.outerHTML, getCurrentUrl(), {}, {}, getCurrentUrl(), getOriginUrl()
        // );
        // const parsedInfo = epub.check();
        // return Promise.resolve(parsedInfo);
        /*images: parsedInfo.images.map((url) => {
            return getAbsoluteUrl(url);
        })*/
    }
    /** Received the Convert/Download action **/
    else if (message.type === 'convert') {
        message.coverUrl = chrome.runtime.getURL('assets/cover.jpg');
        return sendMessageToOffscreenDocument('create-epub', message).then(response => {
            sendResponse({ msg: 'received in background!' })
        });
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