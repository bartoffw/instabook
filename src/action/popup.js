let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg'),
    bookDividerUrl = browser.runtime.getURL('assets/divider.png'),
    currentPageData = null,
    currentChapters = null,
    currentCover = null,
    isChapterMode = false,
    coverCarousel = null,
    carouselElement = {};

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
        selectedCover: 0,
        coverImage: '',
        coverPath: ''
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
                        responseData.title = $('#page-title').text();
                        responseData.customTitle = $('#edit-title').val() !== $('#page-title').text() ? $('#edit-title').val() : '';
                        responseData.url = pageUrl;
                        if (currentPageData !== null && currentPageData['md5'] === MD5(pageUrl)) {
                            responseData = Object.assign(responseData, currentPageData);
                        }
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
                        responseData.title = $('#page-title').text();
                        responseData.url = pageUrl;
                        if (currentPageData !== null && currentPageData['md5'] === MD5(pageUrl)) {
                            responseData = Object.assign(responseData, currentPageData);
                        }
                        addChapter(responseData);
                    })
                    .catch(error => {
                        unexpectedError('Error on adding chapter: ' + error);
                    });
            })
            .catch(error => {
                unexpectedError('Error on tab query: ' + error);
            });
    }
    else if (event.target.id === 'chapters-convert-btn') {
        $('#error-content').hide();
        chaptersBtnLoading();
        sendRuntimeMessage({
            type: 'convert-chapters',
            cover: currentCover,
            chapters: currentChapters,
            dividerUrl: bookDividerUrl
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
        // close previous edit field if any
        if ($('.chapters-edit-chapter-name:visible').length > 0) {
            saveCurrentlyEditedTitle();
        }
        const $name = $(event.target),
            $parent = $name.parent('.chapter-item'),
            $nameEdit = $parent.find('.chapters-edit-chapter-name');
        $nameEdit.val($name.text());
        //$nameEdit.css('height', $name.height() + 'px');
        $name.hide();
        $nameEdit.css('display', 'block').focus();
        $nameEdit[0].setSelectionRange(0, 0);
    }
    else if ($(event.target).hasClass('move-up')) {
        const $item = $(event.target).parents('.chapter-item'),
            $prev = $item.prev('.chapter-item:not(.chapter-template)');
        if ($prev.length > 0) {
            $item.insertBefore($prev);
            refreshChaptersButtons();
            reorderChapters();
        }
    }
    else if ($(event.target).hasClass('move-down')) {
        const $item = $(event.target).parents('.chapter-item'),
            $next = $item.next('.chapter-item');
        if ($next.length > 0) {
            $item.insertAfter($next);
            refreshChaptersButtons();
            reorderChapters();
        }
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
        saveCurrentlyEditedTitle();
    }
});

document.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        if (event.target.id === 'edit-title') {
            if ($('#edit-title').val() !== pageTitle) {
                saveEditedTitle($('#edit-title').val());
            } else {
                displayTitle(pageTitle, false);
            }
        } else if (event.target.id === 'chapters-edit-title') {
            if ($('#chapters-edit-title').val() !== currentCover.title) {
                saveEditedChaptersTitle($('#chapters-edit-title').val());
            } else {
                displayChaptersTitle(currentCover.title, false);
            }
        } else if ($(event.target).hasClass('chapters-edit-chapter-name')) {
            const $edit = $('.chapters-edit-chapter-name:visible'),
                chapterId = $edit.parents('.chapter-item').data('chapter-id');
            if (chapterId in currentChapters) {
                if ($edit.val() !== currentChapters[chapterId].title) {
                    saveEditedChapterTitle($edit.val(), chapterId);
                } else {
                    displayChapterTitle(currentChapters[chapterId].title, chapterId);
                }
            }
        }
    }
});

function saveCurrentlyEditedTitle() {
    const $edit = $('.chapters-edit-chapter-name:visible'),
        chapterId = $edit.parents('.chapter-item').data('chapter-id');
    if (chapterId in currentChapters) {
        if ($edit.val() !== currentChapters[chapterId].title) {
            saveEditedChapterTitle($edit.val(), chapterId);
        } else {
            displayChapterTitle(currentChapters[chapterId].title, chapterId);
        }
    }
}

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

function displayChapterTitle(title, chapterId) {
    //const $chapterItem = $(`.chapter-item[data-chapter-id='${chapterId}']`),
    //    $chapterName = $chapterItem.find('.chapter-name');
    const $edit = $('.chapters-edit-chapter-name:visible'),
        $chapterName = $edit.parents('.chapter-item').find('.chapter-name');
    $chapterName.text(title);
    $chapterName.show();
    $edit.hide();
}

function saveEditedTitle(customTitle) {
    displayTitle(customTitle, true);
    Storage.storeValue(pageUrl, titleKey, customTitle);
}

function saveEditedChaptersTitle(customTitle) {
    currentCover.customTitle = customTitle;
    Storage.storeGlobalValue(coverKey, currentCover);
    displayChaptersTitle(customTitle, true);
}

function saveEditedChapterTitle(customTitle, chapterId) {
    currentChapters[chapterId].title = customTitle;
    Storage.storeGlobalValue(chaptersKey, currentChapters);
    displayChapterTitle(customTitle, chapterId);
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
        currentChapters[urlMd5] = chapterData;
        Storage.storeGlobalValue(chaptersKey, currentChapters);

        currentCover.readTime = 0;
        const chaptersKeys = Object.keys(currentChapters);
        for (const chapterKey of chaptersKeys) {
            currentCover.readTime += currentChapters[chapterKey].readTime;
        }
        currentCover.coverImages.push(chapterData.coverImage);
        Storage.storeGlobalValue(coverKey, currentCover);

        refreshUI();
        addCoverCarouselItem(chapterData.coverImage);
        //refreshCoverCarousel();
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
    //console.log('delete chapter: ' + chapterId);
    if (chapterId in currentChapters) {
        const imageIdx = currentCover.coverImages.indexOf(currentChapters[chapterId].coverImage);
        if (imageIdx >= 0) {
            //console.log('cover: ' + currentCover.selectedCover + ', idx: ' + imageIdx);
            if (currentCover.selectedCover === imageIdx) {
                currentCover.selectedCover = 0;
            } else if (currentCover.selectedCover > imageIdx) {
                currentCover.selectedCover -= 1;
            }
            currentCover.coverImages.splice(imageIdx, 1);
            //console.log('cover after: ' + currentCover.selectedCover);
            deleteCoverCarouselItem(imageIdx);
        }
        delete currentChapters[chapterId];
        // reindex source URLs
        currentCover.sourceUrls = [];
        currentCover.readTime = 0;
        const chaptersKeys = Object.keys(currentChapters);
        for (const chapterKey of chaptersKeys) {
            const chapter = currentChapters[chapterKey];
            const urlDomain = (new URL(chapter.url)).hostname;
            if (!currentCover.sourceUrls.includes(urlDomain)) {
                currentCover.sourceUrls.push(urlDomain);
            }
            currentCover.readTime += chapter.readTime;
        }
        Storage.storeGlobalValue(chaptersKey, currentChapters);
        Storage.storeGlobalValue(coverKey, currentCover);
        refreshUI();
        //refreshCoverCarousel();
    }
}

function reorderChapters() {
    let newChaptersList = {};
    $('#chapters-list .chapter-item:not(.chapter-template)').each(function () {
        const chapterId = $(this).data('chapter-id');
        if (chapterId in currentChapters) {
            newChaptersList[chapterId] = currentChapters[chapterId];
        }
    });
    currentChapters = newChaptersList;
    Storage.storeGlobalValue(chaptersKey, currentChapters);
}

function loadChapters() {
    Storage.getStoredGlobalValue(chaptersKey, {}).then((storedChapters) => {
        currentChapters = storedChapters;
        isChapterMode = Object.keys(currentChapters).length > 0;
        Storage.getStoredGlobalValue(coverKey, defaultCoverData).then((storedCover) => {
            currentCover = storedCover;
            refreshUI();
            refreshCoverCarousel();
            /*$('#chapters-list').sortable({
                handle: 'span.grippy'
            }).bind('sortupdate', (e, ui) => {
                console.log(e, ui.item);
            });*/
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
            $chapterElement.find('.chapter-name').html(chapter.title);
            $('#chapters-list').append($chapterElement);
        }
        refreshChaptersButtons();
    }
}

function refreshChaptersButtons() {
    $('#chapters-list .chapter-item .move-item .move-up, #chapters-list .chapter-item .move-item .move-down').show();
    $('#chapters-list .chapter-item:not(.chapter-template):first .move-item .move-up').hide();
    $('#chapters-list .chapter-item:last .move-item .move-down').hide();
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'conversion-finished') {
        btnLoading(false);
    } else if (message.type === 'chapters-conversion-finished') {
        chaptersBtnLoading(false);
    }
})

function sendRuntimeMessage(data) {
    const result = browser.runtime.sendMessage(data);
    result.then((response) => {
        //btnLoading(false);
    }, (error) => {
        unexpectedError('Error on background script query: ' + error);
        btnLoading(false);
        chaptersBtnLoading(false);
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

function chaptersBtnLoading(isLoading = true) {
    if (isLoading) {
        $('#chapters-convert-spinner').removeClass('visually-hidden');
        $('#chapters-convert-btn').prop('disabled', true);
    } else {
        $('#chapters-convert-spinner').addClass('visually-hidden');
        $('#chapters-convert-btn').prop('disabled', false);
    }
}

function sanitizeUrl(url) {
    if (url.indexOf('?') > 0) {
        url = window.location.href.split('?')[0];
    }
    url = url.substring(0, url.lastIndexOf('/') + 1);
    return url;
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

function addCoverCarouselItem(coverImage) {
    const $carouselIndicators = $('#cover-carousel .carousel-indicators');
    let $indicatorElement = $('#cover-carousel .indicator-button').first().clone();
    let $imageElement = $('#cover-carousel .carousel-item').first().clone();
    $indicatorElement.removeClass('active');
    $indicatorElement.removeAttr('aria-current');
    $imageElement.removeClass('active');
    $imageElement.find('.cover-image').css('background-image', 'url(' + coverImage + ')');

    $carouselIndicators.append($indicatorElement);
    $('#cover-carousel .carousel-inner').append($imageElement);

    console.log($carouselIndicators, $('#cover-carousel .carousel-inner'));

    $carouselIndicators.children().each(function (index, item) {
        $(item).attr('data-bs-slide-to', index);
        $(item).attr('aria-label', 'Slide ' + (index + 1));
    });
}

function deleteCoverCarouselItem(imageIdx) {
    const imgElement = $('#cover-carousel .carousel-item:eq(' + imageIdx + ')');
    const imgIndicator = $('#cover-carousel .indicator-button:eq(' + imageIdx + ')');
    if (imgElement !== null) {
        carouselElement = {
            slide: imgElement,
            indicator: imgIndicator,
        };
        if (imgElement.hasClass('active')) {
            $('#cover-carousel').carousel('prev');
        } else {
            doDeleteCarouselItem();
        }
    } else {
        carouselElement = {};
    }
}

$('#cover-carousel').on('slid.bs.carousel', function () {
    if (typeof carouselElement.slide !== 'undefined' && typeof carouselElement.indicator !== 'undefined') {
        doDeleteCarouselItem();
    }
});

function doDeleteCarouselItem() {
    carouselElement.slide.remove();
    carouselElement.indicator.remove();
    $('#cover-carousel .carousel-indicators').children().each(function (index, item) {
        $(item).attr('data-slide-to', index);
    });
    carouselElement = {};
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

    pageData.imageUrls = {};
    pageData.imageItems = [];
    pageData.url = url;
    pageData.md5 = urlMd5;
    pageData.author = responseData.author.length > 0 ? responseData.author : '';
    pageData.readTime = responseData.readTime;
    pageData.coverImage = responseData.cover;
    pageData.dividerUrl = bookDividerUrl;

    currentPageData = pageData;

    // currentChapters[urlMd5] = chapterData;
    // Storage.storeGlobalValue(chaptersKey, currentChapters);
}

function formatTime(timeInMinutes, asObject = false) {
    const hours = Math.floor(timeInMinutes / 60);
    timeInMinutes -= hours * 60;
    return asObject ?
        { hours: hours, minutes: timeInMinutes, seconds: 0 } :
        (hours > 0 ? hours + (hours === 1 ? ' hour ' : ' hours ') : '') + timeInMinutes;
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
                            $('#time-field').html(formatTime(response.readTime) + ' minutes');

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
                            chaptersBtnLoading(false);
                        });
                })
                .catch(error => {
                    unexpectedError('Error on tab query: ' + error);
                    btnLoading(false);
                    chaptersBtnLoading(false);
                });
        }, reportExecuteScriptError);
}

loadChapters();