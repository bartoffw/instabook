browser.runtime.onMessage.addListener(request => {
    if (request === 'get') {
        return Promise.resolve(document.documentElement.outerHTML);
    }
    else if (request === 'img') {
        // TODO: return Promise.resolve(document.documentElement.outerHTML);
    }
});
