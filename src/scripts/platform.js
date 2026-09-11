/**
 * Platform detection shared by every extension page.
 *
 * It answers two narrow questions - is this Android, and is this Gecko - and
 * nothing about screen size or input. Things that genuinely depend on the
 * browser rather than on the device:
 *
 *   - Android has no windows API, so tab queries cannot filter by currentWindow;
 *   - an anchor click is not a dependable way to save a blob on Android,
 *     because the popup is torn down around it;
 *   - Firefox for Android alone draws the action popup as a full-screen overlay
 *     rather than an anchored panel, so the fixed popup width in popup.css has
 *     to be released there. Chromium on Android keeps the anchored panel and
 *     keeps the fixed width with it. That is what `popup-fullscreen` marks.
 *
 * How the released space is then used, and whether controls are sized for a
 * finger, are decided by the width and pointer media queries in popup.css.
 * A tablet with a mouse gets the desktop treatment on both counts.
 *
 * The user agent is checked synchronously so the classes land on <html> before
 * the first paint (no flash of the desktop layout), then runtime.getPlatformInfo()
 * confirms the platform - that is the authoritative answer, but it resolves too
 * late to style with on its own.
 *
 * Loaded before the polyfill, so it talks to whichever global is actually there.
 */
(() => {
    const root = document.documentElement;

    // getBrowserInfo is Gecko-only, and this runs before the polyfill defines a
    // `browser` global on Chromium. The user agent is the backup signal - note
    // that Chromium says "like Gecko" without a version, so the digit matters.
    const isGecko =
        (typeof browser !== 'undefined' && browser.runtime &&
            typeof browser.runtime.getBrowserInfo === 'function') ||
        /\bGecko\/\d/.test(navigator.userAgent);

    function apply(isAndroid) {
        root.classList.toggle('platform-android', isAndroid);
        root.classList.toggle('platform-desktop', !isAndroid);
        root.classList.toggle('engine-gecko', isGecko);
        root.classList.toggle('engine-chromium', !isGecko);
        root.classList.toggle('popup-fullscreen', isAndroid && isGecko);
    }

    apply(/Android/i.test(navigator.userAgent));

    /** true on any Android build - for the tab query and download paths **/
    window.isAndroidPlatform = () => root.classList.contains('platform-android');

    const api = typeof browser !== 'undefined' ? browser :
        (typeof chrome !== 'undefined' ? chrome : null);
    if (!api || !api.runtime || typeof api.runtime.getPlatformInfo !== 'function') {
        return;
    }

    try {
        const info = api.runtime.getPlatformInfo();
        if (info && typeof info.then === 'function') {
            info.then(result => apply(result.os === 'android')).catch(() => {});
        }
    } catch (error) {
        // Manifest V2 Chromium only offers the callback form
        try {
            api.runtime.getPlatformInfo(result => apply(result.os === 'android'));
        } catch (ignored) {}
    }
})();
