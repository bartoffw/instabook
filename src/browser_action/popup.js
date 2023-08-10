let pageUrl = '',
    pageTitle = '';

/**
 * Listening for extension UI events
 */
document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        $('#error-content').hide();

        /** Send the Get message to the content script to get the page content and meta info **/
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'get' })
                    .then(response => {
                        console.log(response.iframes);
                        browser.runtime.sendMessage({
                            type: 'convert',
                            title: tabs[0].title,
                            url: tabs[0].url,
                            html: response.html,
                            iframes: response.iframes,
                            images: response.images,
                            currentUrl: response.currentUrl,
                            originUrl: response.originUrl
                        });
                    })
                    .catch(error => {
                        $('#error-content').html(getErrorText()).show();
                        console.error('Error on send message: ' + error)
                    });
            })
            .catch(error => {
                $('#error-content').html(getErrorText()).show();
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

function getErrorText() {
    return 'Could not download the ebook. ' +
        'Please report the problem <a href="https://github.com/bartoffw/instabook/issues/new?labels=bug&title=' + encodeURIComponent('Error on ' + pageUrl) + '">on GitHub using this link</a>.';
}

/**
 * Getting the cover image and read time from the content script
 */
browser.tabs
    .query({ currentWindow: true, active: true })
    .then((tabs) => {
        pageUrl = tabs[0].url;
        pageTitle = tabs[0].title;
        $("#page-title").text(pageTitle);
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'images' })
                    .then(response => {
                        $('#time-field').html(response.readTime.minutes + ' minutes');
                        if (response.cover.length > 0) {
                            $('<img/>').attr('src', response.cover).on('load', () => {
                                $(this).remove();
                                $('#bg-image').css('background-image', 'url(' + response.cover + ')');
                                $('#convert-btn').prop('disabled', false);
                            });
                        } else {
                            $('#convert-btn').prop('disabled', false);
                        }
                        $('#url-field').html('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');
                    })
                    .catch(error => {
                        $('#error-content').html(getErrorText()).show();
                        console.error('Error on send message: ' + error)
                    });
            })
            .catch(error => {
                $('#error-content').html(getErrorText()).show();
                console.error('Error on tab query: ' + error)
            });
    }, reportExecuteScriptError);