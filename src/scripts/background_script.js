console.log('Hey, background script.');

browser.runtime.onMessage.addListener((msg, sender, sendRes) => {
    if (msg.type === 'convert') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(msg.html, 'text/html');
        const epub = new Epub(doc, msg.url);
        epub.process();
        // TODO: download images
        epub.prepareEpubFile((imgUrl) => {
            return new Promise((success, failure) => {
                //$.get(imgUrl)
            })
        });
    }
    else if (msg.type === 'reset') {
        console.log('Reset msg');
    }
});