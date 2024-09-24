let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg'),
    currentPageData = null,
    currentChapters = null,
    currentCover = null,
    isChapterMode = false,
    coverCarousel = null;

const titleKey = 'customTitle',
    chaptersKey = 'instabookChapters',
    coverKey = 'instabookCover',
    defaultCoverData = {
        title: '',
        customTitle: null,
        authors: [],
        sourceUrls: [],
        readTime: 0,
        coverImages: [
            bookCoverUrl
        ],
        selectedCover: 0
    };

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
    else if (event.target.id === 'chapters-page-title') {
        $('#chapters-edit-title').val($('#chapters-page-title').text());
        $('#chapters-edit-title').css('height', ($('#chapters-page-title').height() + 25) + 'px');
        $('#chapters-page-title').hide();
        $('#chapters-edit-title').css('display', 'block').focus();
    }
    else if (event.target.id === 'chapters-revert-title-btn') {
        currentCover.customTitle = null;
        Storage.storeGlobalValue(coverKey, currentCover);
        displayChaptersTitle(currentCover.title, false);
    }
    else if (event.target.id === 'clear-chapters') {
        clearChapters();
    }
    else if ($(event.target).hasClass('delete-chapter')) {
        deleteChapter($(event.target).parents('.chapter-item').data('chapter-id'));
    }
    else if ($(event.target).hasClass('chapter-name')) {
        const $name = $(event.target),
            $parent = $name.parent('.chapter-item'),
            $nameEdit = $parent.find('.chapters-edit-chapter-name');
        $nameEdit.val($name.text());
        $nameEdit.css('height', ($name.height() * 2) + 'px');
        $name.hide();
        $nameEdit.css('display', 'block').focus();
    }

    // clicking outside of the edited title makes it auto-save
    if (event.target.id !== 'page-title' && event.target.id !== 'edit-title' && $('#edit-title').is(':visible')) {
        if ($('#edit-title').val() !== pageTitle) {
            saveEditedTitle($('#edit-title').val());
        } else {
            displayTitle(pageTitle, false);
        }
    } else if (event.target.id !== 'chapters-page-title' && event.target.id !== 'chapters-edit-title' && $('#chapters-edit-title').is(':visible')) {
        if ($('#chapters-edit-title').val() !== currentCover.title) {
            saveEditedChaptersTitle($('#chapters-edit-title').val());
        } else {
            displayChaptersTitle(currentCover.title, false);
        }
    } else if (!$(event.target).hasClass('chapter-name') && !$(event.target).hasClass('chapters-edit-chapter-name') && $('.chapters-edit-chapter-name').is(':visible')) {
        const $edit = $('.chapters-edit-chapter-name:visible'),
            chapterId = $edit.parents('.chapter-item').data('chapter-id');
        if (chapterId in currentChapters) {
            if ($edit.val() !== currentChapters[chapterId].title) {

            } else {

            }
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
    } else if (event.target.id === 'chapters-edit-title' && event.key === 'Enter') {
        if ($('#chapters-edit-title').val() !== currentCover.title) {
            saveEditedChaptersTitle($('#chapters-edit-title').val());
        } else {
            displayChaptersTitle(currentCover.title, false);
        }
    }
});

function displayTitle(title, isCustom) {
    $('#page-title').text(title);
    $('#page-title').show();
    $('#edit-title').hide();
    if (isCustom) {
        $('#edit-title-btn').hide();
        $('#revert-title-btn').show();
    } else {
        $('#edit-title-btn').show();
        $('#revert-title-btn').hide();
    }
}

function displayChaptersTitle(title, isCustom) {
    $('#chapters-page-title').text(title);
    $('#chapters-page-title').show();
    $('#chapters-edit-title').hide();
    if (isCustom) {
        $('#chapters-edit-title-btn').hide();
        $('#chapters-revert-title-btn').show();
    } else {
        $('#chapters-edit-title-btn').show();
        $('#chapters-revert-title-btn').hide();
    }
}

function saveEditedTitle(customTitle) {
    displayTitle(customTitle, true);
    Storage.storeValue(pageUrl, titleKey, customTitle);
}

function saveEditedChaptersTitle(customTitle) {
    currentCover.customTitle = customTitle;
    displayChaptersTitle(customTitle, true);
    Storage.storeGlobalValue(coverKey, currentCover);
}

function addChapter(chapterData) {
    const urlMd5 = MD5(chapterData.url);
    if (urlMd5 in currentChapters) {
        $('#error-content').html('This article is already added').slideDown();
    } else {
        $('#error-content').html('').hide();

        currentCover.title = chapterData.title;
        if (chapterData.author.length > 0 && (currentCover.authors === [] || !currentCover.authors.includes(chapterData.author))) {
            currentCover.authors.push(chapterData.author);
        }
        const urlDomain = (new URL(chapterData.url)).hostname;
        if (!currentCover.sourceUrls.includes(urlDomain)) {
            currentCover.sourceUrls.push(urlDomain);
        }
        currentCover.readTime += chapterData.readTime;
        currentCover.coverImages.push(chapterData.coverImage);
        Storage.storeGlobalValue(coverKey, currentCover);

        currentChapters[urlMd5] = chapterData;
        Storage.storeGlobalValue(chaptersKey, currentChapters);
        refreshUI();
        refreshCoverCarousel();
    }
}

function clearChapters() {
    currentChapters = {};
    currentCover = defaultCoverData;
    Storage.deleteGlobalValue(chaptersKey);
    Storage.deleteGlobalValue(coverKey);
    refreshUI();
    refreshCoverCarousel();
}

function deleteChapter(chapterId) {
    console.log('delete chapter: ' + chapterId);
    if (chapterId in currentChapters) {
        const imageIdx = currentCover.coverImages.indexOf(currentChapters[chapterId].coverImage);
        if (imageIdx >= 0) {
            console.log('cover: ' + currentCover.selectedCover + ', idx: ' + imageIdx);
            if (currentCover.selectedCover === imageIdx) {
                currentCover.selectedCover = 0;
            } else if (currentCover.selectedCover > imageIdx) {
                currentCover.selectedCover -= 1;
            }
            currentCover.coverImages.splice(imageIdx, 1);
            console.log('cover after: ' + currentCover.selectedCover);
        }
        delete currentChapters[chapterId];
        Storage.storeGlobalValue(chaptersKey, currentChapters);
        Storage.storeGlobalValue(coverKey, currentCover);
        refreshUI();
        refreshCoverCarousel();
    }
}

function loadChapters() {
    Storage.getStoredGlobalValue(chaptersKey, {}).then((storedChapters) => {
        currentChapters = storedChapters;
        isChapterMode = Object.keys(currentChapters).length > 0;
        Storage.getStoredGlobalValue(coverKey, defaultCoverData).then((storedCover) => {
            currentCover = storedCover;
            refreshUI();
            refreshCoverCarousel();
            $('#chapters-list').sortable({
                placeholderClass: 'chapter-template',
                handle: 'span.grippy'
            }).bind('sortupdate', (e, ui) => {
                console.log(ui.item);
            });
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
        $('#chapter-word').text('Chapters');
        $('.offcanvas .offcanvas-header .btn-close').trigger('click');
    } else {
        const chaptersKeys = Object.keys(currentChapters);
        $('#no-chapters').hide();
        $('#chapters-book-preview').show();
        $('#chapters-controls').show();
        $('#chapter-count').text(chaptersKeys.length);
        $('#chapter-count-title').text(chaptersKeys.length);
        $('#chapter-count-download').text(chaptersKeys.length);
        $('#chapter-word').text(chaptersKeys.length > 1 ? 'Chapters' : 'Chapter');
        displayChaptersTitle(
            currentCover.customTitle !== null && currentCover.customTitle !== '' ?
                currentCover.customTitle : currentCover.title
        );
        $('#chapters-time-field').html(formatTime(currentCover.readTime) + ' minutes');
        if (currentCover.sourceUrls.length > 0) {
            $('#chapters-url-field').html(currentCover.sourceUrls.join(', ')).show();
        } else {
            $('#chapters-url-field').html('').hide();
        }
        if (currentCover.authors.length > 0) {
            $('#chapters-author-field').html(currentCover.authors.join(', ')).show();
        } else {
            $('#chapters-author-field').html('').hide();
        }
        for (const chapterKey of chaptersKeys) {
            const chapter = currentChapters[chapterKey];
            let $chapterElement = $('#chapters-list .chapter-template').clone();
            $chapterElement.removeClass('chapter-template');
            $chapterElement.data('chapter-id', chapterKey);
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

function formatTime(timeInMinutes) {
    const hours = Math.floor(timeInMinutes / 60);
    timeInMinutes -= hours * 60;
    return (hours > 0 ? hours + ' hours ' : '') + timeInMinutes;
}

function refreshCoverCarousel() {
    // if (coverCarousel !== null) {
    //     coverCarousel.dispose();
    //     coverCarousel = null;
    // }
    $('#cover-carousel .indicator-button').slice(1).remove();
    $('#cover-carousel .carousel-item').slice(1).remove();
    if (currentCover !== null) {
        currentCover.coverImages.forEach((coverImage, i) => {
            let $indicatorElement = $('#cover-carousel .indicator-button').first(),
                $imageElement = $('#cover-carousel .carousel-item').first();
            if (i > 0) {
                $indicatorElement = $indicatorElement.clone();
                $imageElement = $imageElement.clone();
                $indicatorElement.removeClass('active');
                $indicatorElement.removeAttr('aria-current');
                $imageElement.removeClass('active');
                $('#cover-carousel .carousel-indicators').append($indicatorElement);
                $('#cover-carousel .carousel-inner').append($imageElement);
            }
            $indicatorElement.attr('data-bs-slide-to', i);
            $indicatorElement.attr('aria-label', 'Slide ' + (i + 1));
            $imageElement.find('.cover-image').css('background-image', 'url(' + coverImage + ')');
        });
        if (coverCarousel === null) {
            coverCarousel = new bootstrap.Carousel(document.querySelector('#cover-carousel'));
            document.getElementById('cover-carousel').addEventListener('slide.bs.carousel', function (event) {
                if (event.to !== null) {
                    currentCover.selectedCover = event.to;
                    Storage.storeGlobalValue(coverKey, currentCover);
                }
            });
        }
        coverCarousel.to(currentCover.selectedCover);
    }
}

function addPhotoPreview(photoUrl) {
    // TODO: carousel for the book mode
    if (photoUrl.length > 0) {
        $('<img/>').attr('src', photoUrl).on('load', () => {
            $(this).remove();
            $('#bg-image').css('background-image', 'url(' + photoUrl + ')');
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
}

function setAdditionalData(responseData, url) {
    const urlMd5 = MD5(url);
    let pageData = currentPageData === null || currentPageData.md5 !== urlMd5 ? {} : currentPageData;

    pageData.url = url;
    pageData.md5 = urlMd5;
    pageData.author = responseData.author.length > 0 ? responseData.author : '';
    pageData.readTime = responseData.readTime.minutes;
    pageData.coverImage = responseData.cover;

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
                            } else {
                                $('#author-field').hide();
                            }
                            $('#time-field').html(formatTime(response.readTime.minutes) + ' minutes');

                            addPhotoPreview(response.cover);

                            $('#convert-btn').prop('disabled', false);
                            $('#chapters-convert-btn').prop('disabled', false);

                            $('#url-field').html((new URL(pageUrl)).hostname); //('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');

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