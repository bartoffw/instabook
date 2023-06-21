/**
 * CSS to hide everything on the page,
 * except for elements that have the "beastify-image" class.
 */
const hidePage = `body > :not(#readable-content) {
                    display: none;
                  }`;

/**
 * Listen for clicks on the buttons, and send the appropriate message to
 * the content script in the page.
 */
function listenForClicks() {

    function instabookIt(tabs) {
        browser.tabs.insertCSS({ code: hidePage }).then(() => {
            browser.tabs.sendMessage(tabs[0].id, {
                command: "instabookit"/*,
                purify: $('#purify').is(':checked')*/
            });
        });
    }

    function reset(tabs) {
        browser.tabs.removeCSS({ code: hidePage }).then(() => {
            browser.tabs.sendMessage(tabs[0].id, {
                command: "reset"
            });
        });
    }

    /**
     * Just log the error to the console.
     */
    function reportError(error) {
        console.error(`Could not execute: ${error}`);
    }

    $(document).on('click', '.action-btn', function() {
        console.log('clicked');
        browser.tabs.query({active: true, currentWindow: true})
            .then($(this).attr('id') === 'convert-btn' ? instabookIt : reset)
            .catch(reportError);
    });
}

/**
 * There was an error executing the script.
 * Display the popup's error message, and hide the normal UI.
 */
function reportExecuteScriptError(error) {
    document.querySelector("#popup-content").classList.add("hidden");
    document.querySelector("#error-content").classList.remove("hidden");
    console.error(`Failed to execute the content script: ${error.message}`);
}

/**
 * When the popup loads, inject a content script into the active tab,
 * and add a click handler.
 * If we couldn't inject the script, handle the error.
 */
browser.tabs
    .executeScript({ file: "/content_scripts/instabookit.js" })
    .then(listenForClicks)
    .catch(reportExecuteScriptError);

function setTitle(tabs) {
    console.log('now!');
    $("#page-title").text(tabs[0].title);
}

browser.tabs
    .query({ currentWindow: true, active: true })
    .then(setTitle, reportExecuteScriptError);
