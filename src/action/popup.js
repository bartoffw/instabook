let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg'),
    currentPageData = null,
    currentChapters = null,
    currentCover = null,
    isChapterMode = false;

const titleKey = 'customTitle',
    chaptersKey = 'instabookChapters',
    coverKey = 'instabookCover';

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
                        unexpectedError('Error on send get message: ' + error);
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

                        if (currentPageData !== null && currentPageData['md5'] === MD5(pageUrl)) {
                            responseData = Object.assign(responseData, currentPageData);
                        }
                        addChapter(responseData);
                    })
                    .catch(error => {
                        unexpectedError('Error on adding chapter: ' + error);
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
    const urlMd5 = MD5(chapterData.url);
    if (urlMd5 in currentChapters) {
        $('#error-content').html('This article is already added').slideDown();
    } else {
        $('#error-content').html('').hide();

        if (currentCover['author'] === 'Unknown' && chapterData.author.length > 0) {
            currentCover['author'] = chapterData.author;
        }
        currentCover['readTime'] += chapterData.readTime.minutes;
        let images = currentCover['coverImages'].slice();
        images.unshift(chapterData.cover);
        currentCover['coverImages'] = images;
        Storage.storeGlobalValue(coverKey, currentCover);

        currentChapters[urlMd5] = chapterData;
        Storage.storeGlobalValue(chaptersKey, currentChapters);
        refreshUI();
    }
}

function clearChapters() {
    currentChapters = {};
    Storage.deleteGlobalValue(chaptersKey);
    refreshUI();
}

function loadChapters() {
    Storage.getStoredGlobalValue(chaptersKey, {}).then((storedChapters) => {
        currentChapters = storedChapters;
        isChapterMode = Object.keys(currentChapters).length > 0;
        const defaultCover = {
            author: 'Unknown',
            readTime: 0,
            coverImages: [
                bookCoverUrl
            ],
            selectedCover: 0
        };
        Storage.getStoredGlobalValue(coverKey, defaultCover).then((storedCover) => {
            currentCover = storedCover;
            refreshUI();
        });
    });
}

function refreshUI() {
    getCurrentPageData();

    $('#chapters-list').find('li:not(.chapter-template)').remove();
    if (currentChapters === null || Object.keys(currentChapters).length === 0) {
        $('#no-chapters').show();
        $('#chapters-book-preview').hide();
        $('#chapters-controls').hide();
        $('#chapter-count').text('');
        $('#chapter-count-title').text('0');
        $('#chapter-count-download').text('0');
        $('.offcanvas .offcanvas-header .btn-close').trigger('click');
    } else {
        const chaptersKeys = Object.keys(currentChapters);
        $('#no-chapters').hide();
        $('#chapters-book-preview').show();
        $('#chapters-controls').show();
        $('#chapter-count').text(chaptersKeys.length);
        $('#chapter-count-title').text(chaptersKeys.length);
        $('#chapter-count-download').text(chaptersKeys.length);
        for (const chapterKey of chaptersKeys) {
            const chapter = currentChapters[chapterKey];
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
    $('#book-preview, #convert-btn, #chapter-group').hide();
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

function addPhotoPreview(photoUrl) {
    // TODO: carousel for the book mode
    if (photoUrl.length > 0) {
        $('<img/>').attr('src', photoUrl).on('load', () => {
            $(this).remove();
            $('#bg-image').css('background-image', 'url(' + photoUrl + ')');
            $('#chapters-bg-image').css('background-image', 'url(' + photoUrl + ')');
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
}

function setAdditionalData(responseData, url) {
    const urlMd5 = MD5(url);
    let pageData = currentPageData === null || currentPageData['md5'] !== urlMd5 ? {} : currentPageData;

    pageData['url'] = url;
    pageData['md5'] = urlMd5;
    pageData['author'] = responseData.author.length > 0 ? responseData.author : '';
    pageData['readTime'] = responseData.readTime.minutes;
    pageData['coverImage'] = responseData.cover;

    currentPageData = pageData;

    // currentChapters[urlMd5] = chapterData;
    // Storage.storeGlobalValue(chaptersKey, currentChapters);
}

/**
 * Getting the cover image and read time from the content script
 */
function getCurrentPageData() {
    browser.tabs
        .query({currentWindow: true, active: true})
        .then((tabs) => {
            pageUrl = sanitizeUrl(tabs[0].url);
            pageTitle = tabs[0].title;
            browser.tabs.query({currentWindow: true, active: true})
                .then((tabs) => {
                    browser.tabs
                        .sendMessage(tabs[0].id, {type: 'preview'})
                        .then(response => {
                            setAdditionalData(response, pageUrl);

                            if (response.author.length > 0) {
                                $('#author-field').html(response.author).show();
                                $('#chapters-author-field').html(response.author).show();
                            } else {
                                $('#author-field').hide();
                                $('#chapters-author-field').hide();
                            }
                            $('#time-field').html(response.readTime.minutes + ' minutes');
                            $('#chapters-time-field').html(response.readTime.minutes + ' minutes');

                            addPhotoPreview(response.cover);

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
                            unexpectedError('Error on send preview message: ' + error);
                            btnLoading(false);
                        });
                })
                .catch(error => {
                    unexpectedError('Error on tab query: ' + error);
                    btnLoading(false);
                });
        }, reportExecuteScriptError);
}

loadChapters();