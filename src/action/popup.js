let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg');

/**
 * Listening for extension UI events
 */
document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        $('#error-content').hide();
        btnLoading();

        /** Send the Get message to the content script to get the page content and meta info **/
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'get' })
                    .then(response => {
                        let responseData = response;
                        responseData.type = 'convert';
                        responseData.title = tabs[0].title;
                        responseData.url = tabs[0].url;
                        console.log(responseData);
                        sendRuntimeMessage(responseData);
                    })
                    // .catch(error => {
                    //     unexpectedError('Error on send message: ' + error);
                    //     btnLoading(false);
                    // });
            })
            // .catch(error => {
            //     unexpectedError('Error on tab query: ' + error);
            //     btnLoading(false);
            // });
    }
    else if (event.target.id === 'reset-btn') {
        //console.log('Reset!');
    }
});

function sendRuntimeMessage(data) {
    const result = browser.runtime.sendMessage(data);
    result.then((response) => {
        btnLoading(false);
    }/*, (error) => {
        unexpectedError('Error on background script query: ' + error);
        btnLoading(false);
    }*/);
}

function reportExecuteScriptError(error) {
    //console.error(`Failed to execute the content script: ${error.message}`);
}

function getErrorText() {
    return 'Could not generate the ebook. ' +
        'Please report the problem <a href="https://github.com/bartoffw/instabook/issues/new?labels=bug&title=' + encodeURIComponent('Error on ' + pageUrl) + '">on GitHub using this link</a>.';
}

function unexpectedError(error) {
    $('#error-content').html(getErrorText()).show();
    $('#book-preview, #convert-btn').hide();
    //console.error(error);
}

function btnLoading(isLoading = true) {
    if (isLoading) {
        $('#convert-spinner').removeClass('visually-hidden');
        $('#convert-btn').prop('disabled', true);
    } else {
        $('#convert-spinner').addClass('visually-hidden');
        $('#convert-btn').prop('disabled', false);
    }
}

/**
 * Getting the cover image and read time from the content script
 */
browser.tabs
    .query({ currentWindow: true, active: true })
    .then((tabs) => {
        pageUrl = tabs[0].url;
        pageTitle = tabs[0].title;
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'preview' })
                    .then(response => {
                        $("#page-title").html(response.title.length > 0 ? response.title : pageTitle);
                        if (response.author.length > 0) {
                            $('#author-field').html(response.author).show();
                        } else {
                            $('#author-field').hide();
                        }
                        $('#time-field').html(response.readTime.minutes + ' minutes');
                        if (response.cover.length > 0) {
                            $('<img/>').attr('src', response.cover).on('load', () => {
                                $(this).remove();
                                $('#bg-image').css('background-image', 'url(' + response.cover + ')');
                            }).on('error', () => {
                                if (response.image.length > 0) {
                                    $('<img/>').attr('src', response.image).on('load', () => {
                                        $(this).remove();
                                        $('#bg-image').css('background-image', 'url(' + response.image + ')');
                                    })
                                } else {
                                    $('#bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                                }
                            });
                        } else {
                            $('#bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                        }
                        $('#convert-btn').prop('disabled', false);
                        $('#url-field').html((new URL(pageUrl)).hostname); //('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');
                    })
                    // .catch(error => {
                    //     unexpectedError('Error on send message: ' + error);
                    //     btnLoading(false);
                    // });
            })
            // .catch(error => {
            //     unexpectedError('Error on tab query: ' + error);
            //     btnLoading(false);
            // });
    }, reportExecuteScriptError);