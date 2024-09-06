let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg'),
    currentChapters = null,
    isChapterMode = false;

const titleKey = 'customTitle',
    chaptersKey = 'instabookChapters';

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
                        responseData.title = pageTitle;
                        responseData.displayTitle = $('#page-title').text();
                        responseData.url = pageUrl;
                        sendRuntimeMessage(responseData);
                    })
                    .catch(error => {
                        unexpectedError('Error on send message: ' + error);
                        btnLoading(false);
                    });
            })
            .catch(error => {
                unexpectedError('Error on tab query: ' + error);
                btnLoading(false);
            });
    }
    else if (event.target.id === 'chapter-btn') {
        $('#error-content').hide();

        /** Send the Get message to the content script to get the page content and meta info **/
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'get' })
                    .then(response => {
                        let responseData = response;
                        responseData.title = pageTitle;
                        responseData.displayTitle = $('#page-title').text();
                        responseData.url = pageUrl;
                        addChapter(responseData);
                    })
                    .catch(error => {
                        unexpectedError('Error on send message: ' + error);
                        btnLoading(false);
                    });
            })
            .catch(error => {
                unexpectedError('Error on tab query: ' + error);
                btnLoading(false);
            });
    }
    else if (event.target.id === 'page-title') {
        $('#edit-title').val($('#page-title').text());
        $('#edit-title').css('height', ($('#page-title').height() + 25) + 'px');
        $('#page-title').hide();
        $('#edit-title').css('display', 'block').focus();
    }
    else if (event.target.id === 'revert-title-btn') {
        Storage.deleteValue(pageUrl, titleKey);
        displayTitle(pageTitle, false);
    }
    else if (event.target.id === 'clear-chapters') {
        clearChapters();
    }

    if (event.target.id !== 'page-title' && event.target.id !== 'edit-title' && $('#edit-title').is(':visible')) {
        if ($('#edit-title').val() !== pageTitle) {
            saveEditedTitle($('#edit-title').val());
        } else {
            displayTitle(pageTitle, false);
        }
    }
});

document.addEventListener('keypress', (event) => {
    if (event.target.id === 'edit-title' && event.key === 'Enter') {
        if ($('#edit-title').val() !== pageTitle) {
            saveEditedTitle($('#edit-title').val());
        } else {
            displayTitle(pageTitle, false);
        }
    }
});

function displayTitle(title, isCustom) {
    $('#page-title').text(title);
    $('#page-title').show();
    $('#edit-title').hide();

    $('#chapters-page-title').text(title);
    $('#chapters-page-title').show();
    $('#chapters-edit-title').hide();

    if (isCustom) {
        $('#edit-title-btn').hide();
        $('#revert-title-btn').show();
        $('#chapters-edit-title-btn').hide();
        $('#chapters-revert-title-btn').show();
    } else {
        $('#edit-title-btn').show();
        $('#revert-title-btn').hide();
        $('#chapters-edit-title-btn').hide();
        $('#chapters-revert-title-btn').show();
    }
}

function saveEditedTitle(customTitle) {
    displayTitle(customTitle, true);
    Storage.storeValue(pageUrl, titleKey, customTitle);
}

function addChapter(chapterData) {
    let alreadyExists = false;
    for (const chapter of currentChapters) {
        if (chapter.url === chapterData.url) {
            alreadyExists = true;
        }
    }
    const errorElement = currentChapters.length > 0 ? '#chapters-error-content' : '#error-content';
    if (alreadyExists) {
        $(errorElement).html('This article is already added').show();
    } else {
        $(errorElement).html('').hide();
        currentChapters.push(chapterData);
        Storage.storeGlobalValue(chaptersKey, currentChapters);
        refreshChaptersUI();
    }
}

function clearChapters() {
    currentChapters = [];
    Storage.deleteGlobalValue(chaptersKey);
    refreshChaptersUI();
}

function loadChapters() {
    Storage.getStoredGlobalValue(chaptersKey, []).then((storedChapters) => {
        currentChapters = storedChapters;
        isChapterMode = currentChapters.length > 0;
        refreshChaptersUI();
    });
}

function refreshChaptersUI() {
    $('#chapters-list').find('li:not(.chapter-template)').remove();
    if (currentChapters === null || currentChapters.length === 0) {
        $('#no-chapters').show();
        $('#chapters-list').hide();
        $('#delete-button').hide();
        $('#chapter-count').text('');
        $('#chapter-count-title').text('0');
        $('#standard-card-body').show();
        $('#chapters-card-body').hide();
        $('.offcanvas .offcanvas-header .btn-close').trigger('click');
    } else {
        $('#no-chapters').hide();
        $('#chapters-list').show();
        $('#delete-button').show();
        $('#chapter-count').text(currentChapters.length).show();
        $('#chapter-count-title').text(currentChapters.length);
        $('#standard-card-body').hide();
        $('#chapters-card-body').show();
        for (const chapter of currentChapters) {
            let $chapterElement = $('#chapters-list .chapter-template').clone();
            $chapterElement.removeClass('chapter-template');
            $chapterElement.find('.chapter-name').html(chapter.displayTitle);
            $('#chapters-list').append($chapterElement);
        }
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'conversion-finished') {
        btnLoading(false);
    }
})

function sendRuntimeMessage(data) {
    const result = browser.runtime.sendMessage(data);
    result.then((response) => {
        //btnLoading(false);
    }, (error) => {
        unexpectedError('Error on background script query: ' + error);
        btnLoading(false);
    });
}

function reportExecuteScriptError(error) {
    console.error(`Failed to execute the content script: ${error.message}`);
}

function getErrorText() {
    return 'Could not generate the ebook. ' +
        'Please report the problem <a href="https://github.com/bartoffw/instabook/issues/new?labels=bug&title=' + encodeURIComponent('Error on ' + pageUrl) + '">on GitHub using this link</a>.';
}

function unexpectedError(error) {
    $('#error-content').html(getErrorText()).show();
    $('#book-preview, #convert-btn').hide();
    console.error(error);
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

function sanitizeUrl(url) {
    if (url.indexOf('?') > 0) {
        url = window.location.href.split('?')[0];
    }
    url = url.substring(0, url.lastIndexOf('/') + 1);
    return url;
}

/**
 * Getting the cover image and read time from the content script
 */
browser.tabs
    .query({ currentWindow: true, active: true })
    .then((tabs) => {
        pageUrl = sanitizeUrl(tabs[0].url);
        pageTitle = tabs[0].title;
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'preview' })
                    .then(response => {
                        if (response.author.length > 0) {
                            $('#author-field').html(response.author).show();
                            $('#chapters-author-field').html(response.author).show();
                        } else {
                            $('#author-field').hide();
                            $('#chapters-author-field').hide();
                        }
                        $('#time-field').html(response.readTime.minutes + ' minutes');
                        $('#chapters-time-field').html(response.readTime.minutes + ' minutes');
                        // TODO: carousel for the book mode
                        if (response.cover.length > 0) {
                            $('<img/>').attr('src', response.cover).on('load', () => {
                                $(this).remove();
                                $('#bg-image').css('background-image', 'url(' + response.cover + ')');
                                $('#chapters-bg-image').css('background-image', 'url(' + response.cover + ')');
                            }).on('error', () => {
                                if (response.image.length > 0) {
                                    $('<img/>').attr('src', response.image).on('load', () => {
                                        $(this).remove();
                                        $('#bg-image').css('background-image', 'url(' + response.image + ')');
                                        $('#chapters-bg-image').css('background-image', 'url(' + response.image + ')');
                                    })
                                } else {
                                    $('#bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                                    $('#chapters-bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                                }
                            });
                        } else {
                            $('#bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                            $('#chapters-bg-image').css('background-image', 'url(' + bookCoverUrl + ')');
                        }
                        $('#convert-btn').prop('disabled', false);
                        $('#chapters-convert-btn').prop('disabled', false);

                        $('#url-field').html((new URL(pageUrl)).hostname); //('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');
                        $('#chapters-url-field').html((new URL(pageUrl)).hostname);

                        // get custom title if exists
                        Storage.getStoredValue(pageUrl, titleKey).then((customTitle) => {
                            displayTitle(customTitle ? customTitle : pageTitle, customTitle);
                        });
                    })
                    .catch(error => {
                        unexpectedError('Error on send message: ' + error);
                        btnLoading(false);
                    });
            })
            .catch(error => {
                unexpectedError('Error on tab query: ' + error);
                btnLoading(false);
            });
    }, reportExecuteScriptError);

loadChapters();