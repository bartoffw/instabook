document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        console.log('Convert!');

        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'get' })
                    .then(response => {
                        browser.runtime.sendMessage({
                            type: 'convert',
                            title: tabs[0].title,
                            url: tabs[0].url,
                            html: response.html,
                            iframes: response.iframes
                        });
                    })
                    .catch(error => {
                        console.error('Error on send message: ' + error)
                    });
            })
            .catch(error => {
                console.error('Error on tab query: ' + error)
            });
    }
    else if (event.target.id === 'reset-btn') {
        console.log('Reset!');
    }
});

function reportExecuteScriptError(error) {
    // document.querySelector("#popup-content").classList.add("d-none");
    // document.querySelector("#error-content").classList.remove("d-none");
    console.error(`Failed to execute the content script: ${error.message}`);
}

browser.tabs
    .query({ currentWindow: true, active: true })
    .then((tabs) => { $("#page-title").text(tabs[0].title); }, reportExecuteScriptError);