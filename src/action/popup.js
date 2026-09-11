let pageUrl = '',
    pageTitle = '',
    bookCoverUrl = browser.runtime.getURL('assets/cover.jpg'),
    bookDividerUrl = browser.runtime.getURL('assets/divider.png'),
    currentPageData = null,
    currentChapters = null,
    currentCover = null,
    currentSettings = {},
    isChapterMode = false,
    coverCarousel = null,
    carouselElement = {},
    /** single article mode cover images **/
    foundCoverImages = [],
    coverImages = [],
    selectedCoverImage = 0,
    customCoverImage = null,
    singleCoverCarousel = null;

const titleKey = 'customTitle',
    coverImageKey = 'selectedCoverImage',
    customCoverKey = 'customCoverImage',
    chaptersKey = 'instabookChapters',
    coverKey = 'instabookCover',
    settingsKey = 'instabookSettings',
    minCoverImageSize = 100,
    // uploaded covers are downscaled before they are stored and sent over
    maxCoverImageSize = 1600,
    maxCoverFileSize = 20 * 1024 * 1024,
    coverCheckTimeout = 4000,
    defaultSettings = {
        includeComments: false,
        shortenTitles: false
    },
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
 * Checking for pending local storage messages
 */
document.addEventListener('DOMContentLoaded', async function() {
    // Check for pending messages from background
    try {
        const result = await browser.storage.local.get(null);
        const keysToRemove = [];
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

        for (const [key, value] of Object.entries(result)) {
            // Only process recent messages (within last 5 minutes)
            if (key.startsWith('epub_') && value.timestamp && value.timestamp >= fiveMinutesAgo) {
                handleEpubDownload(value);
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            await browser.storage.local.remove(keysToRemove);
            console.log('Cleaned up pending EPUB data:', keysToRemove);
        }
    } catch (error) {
        console.error('Error checking pending messages:', error);
    }
});

/**
 * Listening for extension UI events
 */
document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        $('#error-content').hide();
        btnLoading();

        /** Send the Get message to the content script to get the page content and meta info **/
        queryActiveTab()
            .then((tabs) => {
                sendMessageToTabWithRetry(tabs[0].id, { type: 'get' })
                    .then(response => {
                        let responseData = response;
                        responseData.type = 'convert';
                        responseData.title = $('#page-title').text();
                        responseData.customTitle = $('#edit-title').val() !== $('#page-title').text() ? $('#edit-title').val() : '';
                        responseData.url = pageUrl;
                        if (currentPageData !== null && currentPageData['md5'] === MD5(pageUrl)) {
                            responseData = Object.assign(responseData, currentPageData);
                        }
                        responseData.includeComments = currentSettings.includeComments ?? false;
                        responseData.shortenTitles = currentSettings.shortenTitles ?? false;
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
        queryActiveTab()
            .then((tabs) => {
                sendMessageToTabWithRetry(tabs[0].id, { type: 'get' })
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
    else if (event.target.id === 'chapters-convert-btn' || event.target.id === 'chapters-convert-text') {
        $('#error-content').hide();
        chaptersBtnLoading();
        sendRuntimeMessage({
            type: 'convert-chapters',
            cover: currentCover,
            chapters: currentChapters,
            dividerUrl: bookDividerUrl,
            includeComments: currentSettings.includeComments ?? false,
            shortenTitles: currentSettings.shortenTitles ?? false
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
    else if (event.target.id === 'revert-cover-btn') {
        customCoverImage = null;
        Storage.deleteValue(pageUrl, customCoverKey);
        Storage.deleteValue(pageUrl, coverImageKey);
        refreshCoverImages();
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
    else if (event.target.closest('#pdf-convert')) {
        $('#pdf-file-input').trigger('click');
    }
    else if (event.target.id === 'downloaded-from' || event.target.id === 'url-field') {
        currentPageData.hideDownloadedFrom = true;
        $('#downloaded-from').hide();
    }
    else if (event.target.id === 'chapters-downloaded-from' || event.target.id === 'chapters-url-field') {
        currentPageData.hideDownloadedFrom = true;
        $('#chapters-downloaded-from').hide();
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

document.addEventListener('change', (event) => {
    if (event.target.id === 'shorten-titles') {
        currentSettings.shortenTitles = event.target.checked;
        Storage.storeGlobalValue(settingsKey, currentSettings);
    }
    if (event.target.id === 'include-comments') {
        currentSettings.includeComments = event.target.checked;
        Storage.storeGlobalValue(settingsKey, currentSettings);
    }
    $('#settings-enabled').css('display', (currentSettings.includeComments ?? false) || (currentSettings.shortenTitles ?? false) ? 'inline' : 'none');
});

document.addEventListener('change', (event) => {
    if (event.target.id === 'pdf-file-input') {
        const file = event.target.files[0];
        event.target.value = '';   // allow re-picking the same filename later
        if (file) {
            handlePdfFileSelected(file);
        }
    }
    else if (event.target.id === 'cover-file-input') {
        const file = event.target.files[0];
        event.target.value = '';   // allow re-picking the same filename later
        if (file) {
            handleCoverFileSelected(file);
        }
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
    $chapterName.attr('title', title);
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
    currentChapters[chapterId].titleEdited = true;
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
    if (chapterId in currentChapters) {
        const imageIdx = currentCover.coverImages.indexOf(currentChapters[chapterId].coverImage);
        if (imageIdx >= 0) {
            if (currentCover.selectedCover === imageIdx) {
                currentCover.selectedCover = 0;
            } else if (currentCover.selectedCover > imageIdx) {
                currentCover.selectedCover -= 1;
            }
            currentCover.coverImages.splice(imageIdx, 1);
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
        });
    });
}

function refreshUI() {
    loadSettings();
    getCurrentPageData();

    $('#chapters-list').find('li:not(.chapter-template)').remove();
    if (currentChapters === null || Object.keys(currentChapters).length === 0) {
        $('#no-chapters').show();
        $('#chapters-book-preview').hide();
        $('#chapters-controls').hide();
        $('#chapter-count').text('');
        $('#chapter-count-title').text('0');
        $('#chapters-convert-text').text('Download 0 Chapters');
        $('.offcanvas .offcanvas-header .btn-close').trigger('click');
    } else {
        const chaptersKeys = Object.keys(currentChapters);
        $('#no-chapters').hide();
        $('#chapters-book-preview').show();
        $('#chapters-controls').show();
        $('#chapter-count').text(chaptersKeys.length);
        $('#chapter-count-title').text(chaptersKeys.length);
        $('#chapters-convert-text').text('Download ' + chaptersKeys.length + ' ' + (chaptersKeys.length > 1 ? 'Chapters' : 'Chapter'));
        displayChaptersTitle(
            currentCover.customTitle !== null && currentCover.customTitle !== '' ?
                currentCover.customTitle : currentCover.title
        );
        $('#chapters-time-field').html(formatTime(currentCover.readTime));
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
        cleanupChapters();
        for (const chapterKey of chaptersKeys) {
            const chapter = currentChapters[chapterKey],
                chapterTitle = (currentSettings.shortenTitles ?? false) &&
                    typeof chapter.cleanTitle !== 'undefined' && chapter.cleanTitle !== '' &&
                    (typeof chapter.titleEdited === 'undefined' || !chapter.titleEdited) ?
                        chapter.cleanTitle : chapter.title;
            let $chapterElement = $('#chapters-list .chapter-template').clone();
            $chapterElement.removeClass('chapter-template');
            $chapterElement.data('chapter-id', chapterKey);
            $chapterElement.find('.chapter-name').html(chapterTitle);
            $chapterElement.find('.chapter-name').attr('title', chapterTitle);
            $('#chapters-list').append($chapterElement);
        }
        refreshChaptersButtons();
    }
}

function loadSettings() {
    Storage.getStoredGlobalValue(settingsKey, defaultSettings).then((storedSettings) => {
        currentSettings = storedSettings;
        $('#include-comments').prop('checked', currentSettings.includeComments ?? false);
        $('#shorten-titles').prop('checked', currentSettings.shortenTitles ?? false);
        $('#settings-enabled').css('display', (currentSettings.includeComments ?? false) || (currentSettings.shortenTitles ?? false) ? 'inline' : 'none');
    });
}

/**
 * Works out the shortened name of every chapter, used when the "Shorten repeatable
 * titles" setting is on. A chapter whose name the user has edited keeps it, and a
 * chapter with nothing to shorten keeps no shortened name at all, so that one left
 * over from an earlier set of chapters is never shown.
 */
function cleanupChapters() {
    const chapterKeys = Object.keys(currentChapters),
        shortened = Titles.shortenTitles(chapterKeys.map((key) => currentChapters[key].title));
    chapterKeys.forEach((key, index) => {
        const chapter = currentChapters[key],
            cleanTitle = typeof shortened[index] === 'string' ? shortened[index] : '';
        chapter.cleanTitle = chapter.titleEdited || cleanTitle === chapter.title ? '' : cleanTitle;
    });
}

function refreshChaptersButtons() {
    $('#chapters-list .chapter-item .move-item .move-up, #chapters-list .chapter-item .move-item .move-down').show();
    $('#chapters-list .chapter-item:not(.chapter-template):first .move-item .move-up').hide();
    $('#chapters-list .chapter-item:last .move-item .move-down').hide();
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'popup') {
        if (message.type === 'epub-ready') {
            handleEpubDownload(message.data);
            btnLoading(false);
        } else if (message.type === 'chapters-epub-ready') {
            handleEpubDownload(message.data);
            chaptersBtnLoading(false);
        }
    }
});

/**
 * The background answers a conversion request with an error rather than
 * throwing, and nothing used to read that answer - so a failed conversion left
 * the button spinning with no explanation. That matters most on Android, where
 * the background is the likeliest thing to be torn down mid-run.
 */
async function sendRuntimeMessage(data) {
    try {
        const response = await browser.runtime.sendMessage(data);
        if (response && response.error) {
            throw new Error(response.error);
        }
    } catch (error) {
        btnLoading(false);
        chaptersBtnLoading(false);
        conversionError(error.message || String(error));
    }
}

/**
 * Unlike unexpectedError, this leaves the preview and the buttons in place: a
 * conversion that failed once is worth retrying, and hiding the controls would
 * make the popup a dead end until it is reopened.
 */
function conversionError(error) {
    $('#error-content').addClass('alert').html(getErrorText(error)).show();
    console.error(error);
}

async function handleEpubDownload(epubData) {
    try {
        let buffer;
        if (epubData.storageKey) {
            // Retrieve EPUB data from storage
            const result = await browser.storage.local.get([epubData.storageKey]);
            if (!result[epubData.storageKey]) {
                throw new Error('EPUB data not found in storage');
            }

            buffer = result[epubData.storageKey].buffer;

            // Clean up storage after retrieving
            await browser.storage.local.remove([epubData.storageKey]);
        } else {
            // Fallback: data passed directly (for backwards compatibility)
            buffer = epubData.buffer;
        }

        // Convert array buffer to Blob
        const uint8Array = new Uint8Array(buffer);
        const blob = new Blob([uint8Array], { type: 'application/epub+zip' });

        // Create download URL
        const url = URL.createObjectURL(blob);

        const savedByApi = await saveThroughDownloadsApi(url, epubData.filename);
        if (!savedByApi) {
            saveThroughLink(url, epubData.filename);
            // Clean up the blob URL
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
        }

    } catch (error) {
        console.error('Error downloading EPUB in popup:', error);
    }
}

/**
 * The anchor click below is what desktop has always used and it stays there.
 * It is not dependable on Firefox for Android, where the popup is a full-screen
 * overlay that tears down around the click, so mobile hands the blob to the
 * downloads API instead and lets the browser own the transfer.
 *
 * Returns false when the API route is unavailable, so the caller can fall back.
 */
async function saveThroughDownloadsApi(url, filename) {
    const isAndroid = typeof window.isAndroidPlatform === 'function' && window.isAndroidPlatform();
    if (!isAndroid || typeof browser.downloads === 'undefined') {
        return false;
    }
    // path characters are already stripped when the name is built, but the API
    // is stricter than an anchor about control characters and leading dots
    const safeName = filename
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/^[.\s]+/, '')
        .trim() || 'instabook.epub';
    try {
        const downloadId = await browser.downloads.download({
            url: url,
            filename: safeName,
            saveAs: false
        });
        revokeWhenDownloadSettles(downloadId, url);
        return true;
    } catch (error) {
        console.error('Downloads API refused the EPUB, falling back to a link:', error);
        return false;
    }
}

function saveThroughLink(url, filename) {
    // Create download link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    // Add to document, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Revoking the blob URL while the download is still reading from it truncates
 * the file, so it is held until the transfer leaves the in_progress state.
 * The timeout is the backstop for a popup that is dismissed before that.
 */
function revokeWhenDownloadSettles(downloadId, url) {
    let released = false;
    const release = () => {
        if (released) {
            return;
        }
        released = true;
        if (browser.downloads.onChanged.hasListener(onChanged)) {
            browser.downloads.onChanged.removeListener(onChanged);
        }
        URL.revokeObjectURL(url);
    };
    function onChanged(delta) {
        if (delta.id === downloadId && delta.state && delta.state.current !== 'in_progress') {
            release();
        }
    }
    browser.downloads.onChanged.addListener(onChanged);
    setTimeout(release, 60000);
}

/**
 * Hands a user-picked PDF off to the full-tab converter page. chrome.storage.local
 * is JSON-serialized (not structured-clone), so the ArrayBuffer is converted to a
 * plain number array first - mirrors the same workaround already used for outgoing
 * EPUB blobs (see offscreen.js's sendEpubToBackground()).
 */
async function handlePdfFileSelected(file) {
    try {
        await cleanupOldPdfConvData();
        const buffer = Array.from(new Uint8Array(await file.arrayBuffer()));
        const storageKey = `pdfconv_${Date.now()}`;
        await browser.storage.local.set({
            [storageKey]: { buffer: buffer, filename: file.name, timestamp: Date.now() }
        });
        await browser.tabs.create({
            url: browser.runtime.getURL('action/pdf-converter.html') + '?key=' + encodeURIComponent(storageKey)
        });
        window.close();
    } catch (error) {
        unexpectedError('Error opening the PDF converter: ' + error);
    }
}

async function cleanupOldPdfConvData() {
    try {
        const result = await browser.storage.local.get(null);
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const keysToRemove = Object.entries(result)
            .filter(([key, value]) => key.startsWith('pdfconv_') && value.timestamp && value.timestamp < fiveMinutesAgo)
            .map(([key]) => key);
        if (keysToRemove.length > 0) {
            await browser.storage.local.remove(keysToRemove);
        }
    } catch (error) {
        console.error('Error cleaning up old PDF conversion data:', error);
    }
}

/**
 * Firefox for Android has no windows API - there is only ever one window - so
 * currentWindow is dropped there. It has to stay on desktop, where without it
 * the query comes back with the active tab of every open window.
 */
function queryActiveTab() {
    const isAndroid = typeof window.isAndroidPlatform === 'function' && window.isAndroidPlatform();
    return browser.tabs.query(isAndroid ? {active: true} : {currentWindow: true, active: true});
}

function reportExecuteScriptError(error) {
    console.error(`Failed to execute the content script: ${error.message}`);
}

function getErrorText(error) {
    return 'Could not generate the ebook. ' +
        'Please report the problem <a href="https://github.com/bartoffw/instabook/issues/new?labels=bug&' +
        'title=' + encodeURIComponent('[1.4] Error on ' + pageUrl) + '&' +
        'body=' + encodeURIComponent(error) + '" target="_blank">on GitHub using this link</a>.';
}

function unexpectedError(error) {
    $('#error-content').html(getErrorText(error)).show();
    $('#book-preview, #convert-btn, #chapter-group').hide();
    console.error(error);
}

function showInfo(info) {
    $('#error-content').removeClass('alert').html(info).show();
    $('#book-preview, #convert-btn, #chapter-group').hide();
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
    /*if (url.indexOf('?') > 0) {
        url = window.location.href.split('?')[0];
    }
    url = url.substring(0, url.lastIndexOf('/') + 1);*/
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
            $imageElement.find('.cover-image').css('background-image', 'url("' + coverImage + '")');
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
    $imageElement.find('.cover-image').css('background-image', 'url("' + coverImage + '")');

    $carouselIndicators.append($indicatorElement);
    $('#cover-carousel .carousel-inner').append($imageElement);

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

/**
 * Builds the cover carousel of the single article mode out of the images found in
 * the article, or out of the image uploaded by the user when there is one for this page.
 *
 * @param covers list of image urls found in the article, the default one first
 */
async function setupCoverImages(covers) {
    foundCoverImages = Array.isArray(covers) ?
        covers.filter((url) => typeof url === 'string' && url.length > 0) : [];
    customCoverImage = await Storage.getStoredValue(pageUrl, customCoverKey) ?? null;
    const storedCover = await Storage.getStoredValue(pageUrl, coverImageKey);
    refreshCoverImages(typeof storedCover === 'string' ? storedCover : null);
    if (customCoverImage === null) {
        verifyCoverImages();
    }
}

/**
 * Rebuilds the list of the covers to choose from and selects one of them.
 *
 * @param selectedUrl the cover to select, the first one when it is not on the list
 */
function refreshCoverImages(selectedUrl = null) {
    // an uploaded image replaces everything found on the page, otherwise the built-in
    // cover closes the list so that there is always something to fall back to
    coverImages = customCoverImage !== null ?
        [ customCoverImage ] : foundCoverImages.concat([ bookCoverUrl ]);
    const selectedIdx = selectedUrl === null ? -1 : coverImages.indexOf(selectedUrl);
    selectedCoverImage = selectedIdx >= 0 ? selectedIdx : 0;
    refreshSingleCoverCarousel();
    applySelectedCoverImage(false);
}

function refreshSingleCoverCarousel() {
    $('#single-cover-carousel .indicator-button').slice(1).remove();
    $('#single-cover-carousel .carousel-item').slice(1).remove();
    // the carousel may have been left on a slide that is gone now
    $('#single-cover-carousel .indicator-button').first().addClass('active').attr('aria-current', 'true');
    $('#single-cover-carousel .carousel-item').first().addClass('active');
    coverImages.forEach((coverImage, i) => {
        let $indicatorElement = $('#single-cover-carousel .indicator-button').first(),
            $imageElement = $('#single-cover-carousel .carousel-item').first();
        if (i > 0) {
            $indicatorElement = $indicatorElement.clone();
            $imageElement = $imageElement.clone();
            $indicatorElement.removeClass('active');
            $indicatorElement.removeAttr('aria-current');
            $imageElement.removeClass('active');
            $('#single-cover-carousel .carousel-indicators').append($indicatorElement);
            $('#single-cover-carousel .carousel-inner').append($imageElement);
        }
        $indicatorElement.attr('data-bs-slide-to', i);
        $indicatorElement.attr('aria-label', 'Slide ' + (i + 1));
        $imageElement.find('.cover-image').css('background-image', 'url("' + coverImage + '")');
    });
    if (singleCoverCarousel === null) {
        singleCoverCarousel = new bootstrap.Carousel(document.querySelector('#single-cover-carousel'));
        document.getElementById('single-cover-carousel').addEventListener('slide.bs.carousel', function (event) {
            if (event.to !== null) {
                selectedCoverImage = event.to;
                applySelectedCoverImage();
            }
        });
    }
    singleCoverCarousel.to(selectedCoverImage);
    $('#book-preview').toggleClass('single-cover', coverImages.length <= 1);
    updateCoverButtons();
}

/**
 * Passes the selected cover on to the epub data and remembers it for this page.
 */
function applySelectedCoverImage(store = true) {
    const coverImage = selectedCoverImage in coverImages ? coverImages[selectedCoverImage] : '';
    if (currentPageData !== null) {
        currentPageData.coverImage = coverImage;
    }
    if (store && pageUrl.length > 0) {
        Storage.storeValue(pageUrl, coverImageKey, coverImage);
    }
}

/**
 * Toggled with a class rather than jQuery show/hide: on touch these buttons are
 * grown into flex tap targets, and an inline display written by show() would
 * override that.
 */
function updateCoverButtons() {
    const hasCustomCover = customCoverImage !== null;
    $('#upload-cover-btn').toggleClass('d-none', hasCustomCover);
    $('#revert-cover-btn').toggleClass('d-none', !hasCustomCover);
}

/**
 * Article images are measured on the page itself, but some of them cannot be loaded
 * again here (hotlinking protection) and the ones taken from the meta tags were never
 * measured at all - those are dropped once the carousel is already up.
 */
function verifyCoverImages() {
    const covers = foundCoverImages.slice();
    if (covers.length === 0) {
        return;
    }
    Promise.all(covers.map((coverUrl) => new Promise((resolve) => {
        const image = new Image();
        const finish = (isUsable) => {
            clearTimeout(timeout);
            resolve(isUsable ? coverUrl : null);
        };
        // a slow image is given the benefit of the doubt, the epub falls back on its own
        const timeout = setTimeout(() => finish(true), coverCheckTimeout);
        image.onload = () => finish(
            image.naturalWidth >= minCoverImageSize && image.naturalHeight >= minCoverImageSize
        );
        image.onerror = () => finish(false);
        image.src = coverUrl;
    }))).then((results) => {
        const usableCovers = results.filter((coverUrl) => coverUrl !== null);
        // the upload may have replaced the whole list in the meantime
        if (customCoverImage !== null || usableCovers.length === covers.length) {
            return;
        }
        const selectedUrl = selectedCoverImage in coverImages ? coverImages[selectedCoverImage] : null;
        foundCoverImages = usableCovers;
        refreshCoverImages(selectedUrl);
    });
}

/**
 * Stores the image chosen by the user as the only cover of this page.
 */
async function handleCoverFileSelected(file) {
    try {
        if (!file.type.startsWith('image/')) {
            throw new Error('this is not an image file');
        }
        if (file.size > maxCoverFileSize) {
            throw new Error('the file is bigger than ' + Math.round(maxCoverFileSize / 1024 / 1024) + ' MB');
        }
        customCoverImage = await readCoverImageFile(file);
        Storage.storeValue(pageUrl, customCoverKey, customCoverImage);
        Storage.deleteValue(pageUrl, coverImageKey);
        refreshCoverImages();
        $('#error-content').hide();
    } catch (error) {
        console.error('Error on reading the cover image:', error);
        $('#error-content').html('Could not use this image - ' + error.message + '.').slideDown();
    }
}

/**
 * Reads the uploaded image as a data url, downscaling it first when it is
 * larger than what a cover needs.
 *
 * @param file
 * @returns {Promise<string>}
 */
function readCoverImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('the file could not be read'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('this image format is not supported'));
            image.onload = () => {
                const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
                // vector images have no size of their own, they are kept as they are
                if (largestSide === 0 || largestSide <= maxCoverImageSize) {
                    resolve(reader.result);
                    return;
                }
                const scale = maxCoverImageSize / largestSide,
                    canvas = document.createElement('canvas');
                canvas.width = Math.round(image.naturalWidth * scale);
                canvas.height = Math.round(image.naturalHeight * scale);
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
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
    pageData.hideDownloadedFrom = false;

    currentPageData = pageData;

    // currentChapters[urlMd5] = chapterData;
    // Storage.storeGlobalValue(chaptersKey, currentChapters);
}

function formatTime(timeInMinutes, asObject = false) {
    const hours = Math.floor(timeInMinutes / 60);
    timeInMinutes -= hours * 60;
    if (asObject) {
        return { hours: hours, minutes: timeInMinutes, seconds: 0 };
    } else {
        let result = hours > 0 ? hours + (hours === 1 ? ' hour' : ' hours') : '';
        if (timeInMinutes > 0) {
            result += (result.length > 0 ? ' ' : '') + timeInMinutes + (timeInMinutes === 1 ? ' minute' : ' minutes');
        }
        return result.length > 0 ? result : 'less than a minute';
    }
}

/**
 * Getting the cover image and read time from the content script
 */
function getCurrentPageData() {
    queryActiveTab()
        .then((tabs) => {
            pageUrl = sanitizeUrl(tabs[0].url);
            pageTitle = tabs[0].title;
            queryActiveTab()
                .then((tabs) => {
                    sendMessageToTabWithRetry(tabs[0].id, {
                            type: 'preview',
                            includeComments: currentSettings.includeComments ?? false
                        })
                        .then(response => {
                            setAdditionalData(response, pageUrl);
                            if ((typeof response.author === 'undefined' || response.author.length === 0) && response.readTime === 0 &&
                                (typeof response.cover === 'undefined' || response.cover.length === 0) &&
                                (typeof response.content === 'undefined' || response.content.length < 250)) {
                                if (typeof response.iframes !== 'undefined' && response.iframes.length > 0) {
                                    let iframeLinks = [];
                                    response.iframes.forEach(function (element, index) {
                                        iframeLinks.push(
                                            '<a href="' + element + '" target="_blank" title="' + element + '">Page' + (response.iframes.length > 1 ? ' ' + (index + 1) : '') + ' Link</a>'
                                        );
                                    });
                                    showInfo(
                                        '<p class="text-center"><span class="h1">⚠️</span><br/><br/>' +
                                        'Content not found on this page, but <strong>I found ' +
                                        (response.iframes.length > 1 ? 'some embedded pages' : 'an embedded page') +
                                        '</strong> you can open and try again:<br/><br/>' + iframeLinks.join('<br/>') +
                                        '</p>'
                                    );
                                } else {
                                    showInfo(
                                        '<p class="text-center"><span class="h1">⚠️</span><br/><br/>' +
                                        'Content not found on this page.</p>'
                                    );
                                }
                            } else {
                                if (response.author.length > 0) {
                                    $('#author-field').html(response.author).show();
                                } else {
                                    $('#author-field').hide();
                                }
                                $('#time-field').html(formatTime(response.readTime));

                                setupCoverImages(response.covers);

                                $('#convert-btn').prop('disabled', false);
                                $('#chapters-convert-btn').prop('disabled', false);

                                $('#url-field').html((new URL(pageUrl)).hostname); //('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');

                                // get custom title if exists
                                Storage.getStoredValue(pageUrl, titleKey).then((customTitle) => {
                                    displayTitle(customTitle ? customTitle : pageTitle, customTitle);
                                });
                            }
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

const CHROMIUM_CONTENT_SCRIPTS = [
    'scripts/browser-polyfill.min.js',
    'scripts/jquery.min.js',
    'scripts/jszip-utils.min.js',
    'scripts/purify.js',
    'scripts/filesaver.min.js',
    'scripts/Readability.js',
    'scripts/epub.js',
    'scripts/content_script.js'
];

const FIREFOX_CONTENT_SCRIPTS = [
    'scripts/jquery.min.js',
    'scripts/jszip-utils.min.js',
    'scripts/purify.js',
    'scripts/Readability.js',
    'scripts/epub.js',
    'scripts/content_script.js'
];

async function injectContentScripts(tabId) {
    if (typeof browser.scripting !== 'undefined') {
        await browser.scripting.executeScript({
            target: { tabId },
            files: CHROMIUM_CONTENT_SCRIPTS
        });
    } else {
        for (const file of FIREFOX_CONTENT_SCRIPTS) {
            await browser.tabs.executeScript(tabId, { file });
        }
    }
}

async function sendMessageToTabWithRetry(tabId, message) {
    try {
        return await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
        if (!error.message.includes('Receiving end does not exist')) {
            throw error;
        }
        await injectContentScripts(tabId);
        return await browser.tabs.sendMessage(tabId, message);
    }
}

loadChapters();