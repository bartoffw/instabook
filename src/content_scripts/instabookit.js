(() => {
    /**
     * Check and set a global guard variable.
     * If this content script is injected into the same page again,
     * it will do nothing next time.
     */
    if (window.hasRun) {
        return;
    }
    window.hasRun = true;

    /**
     * Given a URL to a beast image, remove all existing beasts, then
     * create and style an IMG node pointing to
     * that image, then insert the node into the document.
     */
    function doInstabook() {
        removeExistingBook();
        const docClone = document.cloneNode(true);
        const article = new Readability(docClone).parse();

        const readified = document.createElement("div");
        readified.setAttribute("id", "readable-content");
        readified.style.height = "100vh";
        readified.innerHTML = article.content;
        document.body.appendChild(readified);
    }

    /**
     * Remove every beast from the page.
     */
    function removeExistingBook() {
        const existingBook = document.querySelector("#readable-content");
        if (existingBook !== null) {
            existingBook.remove();
        }
    }

    /**
     * Listen for messages from the background script.
     * Call "insertBeast()" or "removeExistingBeasts()".
     */
    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "instabookit") {
            doInstabook();
        } else if (message.command === "reset") {
            removeExistingBook();
        }
    });
})();
