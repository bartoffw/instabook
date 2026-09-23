/**
 * E-ink image optimisation.
 *
 * Pictures and charts taken from a web page are made for a backlit screen, and an
 * e-reader is not one. Colours that look nothing alike turn into the same shade of
 * grey, the panel only has 16 of those to work with, and its contrast is low enough
 * that thin chart lines and axis labels disappear into the background. CSS filters
 * are no help, as e-reader layout engines routinely ignore them, so the images have
 * to be rewritten pixel by pixel before they go into the epub.
 *
 * EinkProcessor holds the pixel work and needs nothing around it - it runs anywhere
 * an ImageData can be had. EinkImages is the part that needs a document: it loads an
 * image, draws it onto a canvas and hands the result back as a blob or a data url.
 */
class EinkProcessor {
    /** full colour - the images are left exactly as they were found */
    static modeColor = 'color';
    /** the 16 shades of grey an e-ink panel actually has */
    static modeGrayscale = 'grayscale';
    /** black and white only, for text and line art */
    static modeMono = 'mono';

    /** compensates for how an e-ink panel absorbs ambient light (1.5 - 2.2) */
    static defaultGamma = 1.8;
    /**
     * The longest side an image is scaled down to before it is dithered. Dithering
     * a photo far larger than any e-reader screen only produces a file the device
     * then has to resample, which is exactly what smears the dot pattern.
     */
    static maxImageSize = 1600;
    /**
     * Vector images carry no pixels of their own, so they are rasterised above the
     * size they are drawn at - curves and small labels would otherwise turn to grey
     * mush the moment they are quantised.
     */
    static vectorScale = 2;

    /**
     * Anything unknown (an older stored setting, a hand-edited value) reads as
     * full colour, which is what the extension did before any of this existed.
     *
     * @param mode
     * @returns {string}
     */
    static normalizeMode(mode) {
        return mode === EinkProcessor.modeGrayscale || mode === EinkProcessor.modeMono ?
            mode : EinkProcessor.modeColor;
    }

    static isEnabled(mode) {
        return EinkProcessor.normalizeMode(mode) !== EinkProcessor.modeColor;
    }

    static paletteMode(mode) {
        return EinkProcessor.normalizeMode(mode) === EinkProcessor.modeMono ? '1-bit' : '16-level';
    }

    static optionsForMode(mode) {
        return {
            gamma: EinkProcessor.defaultGamma,
            sharpen: true,
            mode: EinkProcessor.paletteMode(mode)
        };
    }

    /**
     * Processes an ImageData object in place and returns it.
     *
     * @param {ImageData} imageData - target canvas pixel data
     * @param {Object} options configuration parameters
     * @param {number} [options.gamma=1.8] - gamma curve adjustment (1.5 - 2.2)
     * @param {boolean} [options.sharpen=true] - apply a 3x3 Laplacian sharpening filter
     * @param {'16-level'|'1-bit'} [options.mode='16-level'] - palette quantization mode
     * @returns {ImageData} processed ImageData
     */
    static processImageData(imageData, options = {}) {
        const {
            gamma = EinkProcessor.defaultGamma,
            sharpen = true,
            mode = '16-level'
        } = options;

        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        const totalPixels = width * height;

        // Step 1: convert RGB to perceived lightness and apply gamma correction
        const buf = new Float32Array(totalPixels);
        const gammaInv = 1.0 / gamma;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // transparent pixels are blended onto a solid white background, or the
            // quantisation turns them into a dark grey box around the picture
            let lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (a < 255) {
                const alpha = a / 255;
                lum = lum * alpha + 255 * (1 - alpha);
            }

            // non-linear gamma scaling for e-ink reflective properties
            lum = 255 * Math.pow(lum / 255, gammaInv);
            buf[i / 4] = lum;
        }

        // Step 2: unsharp masking (3x3 high-pass sharpening kernel), which is what
        // keeps thin chart lines, tick marks and text labels alive through step 3
        let sharpBuf = buf;
        if (sharpen) {
            sharpBuf = new Float32Array(totalPixels);
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    // Laplacian sharpening matrix:
                    // [  0, -1,  0 ]
                    // [ -1,  5, -1 ]
                    // [  0, -1,  0 ]
                    const val =
                        5 * buf[idx] -
                        buf[idx - width] -
                        buf[idx - 1] -
                        buf[idx + 1] -
                        buf[idx + width];

                    sharpBuf[idx] = Math.min(255, Math.max(0, val));
                }
            }
            // the kernel has no room to work on the outermost pixels
            for (let x = 0; x < width; x++) {
                sharpBuf[x] = buf[x];
                sharpBuf[(height - 1) * width + x] = buf[(height - 1) * width + x];
            }
            for (let y = 0; y < height; y++) {
                sharpBuf[y * width] = buf[y * width];
                sharpBuf[y * width + (width - 1)] = buf[y * width + (width - 1)];
            }
        }

        // Step 3: Atkinson dithering, which throws away a quarter of the quantisation
        // error instead of diffusing all of it - that is what keeps a white background
        // white rather than speckled
        const is1Bit = mode === '1-bit';
        const levels = is1Bit ? 2 : 16;
        const step = 255 / (levels - 1);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const oldVal = sharpBuf[idx];
                const newVal = is1Bit
                    ? (oldVal > 128 ? 255 : 0)
                    : Math.round(oldVal / step) * step;

                sharpBuf[idx] = newVal;

                const err = (oldVal - newVal) / 8;

                if (err === 0) continue;

                // the error goes to 6 neighbours:
                //      [*]  [1]  [2]
                // [3]  [4]  [5]
                //      [6]
                if (x + 1 < width)                   sharpBuf[idx + 1] += err;
                if (x + 2 < width)                   sharpBuf[idx + 2] += err;
                if (x - 1 >= 0 && y + 1 < height)    sharpBuf[idx + width - 1] += err;
                if (y + 1 < height)                  sharpBuf[idx + width] += err;
                if (x + 1 < width && y + 1 < height) sharpBuf[idx + width + 1] += err;
                if (y + 2 < height)                  sharpBuf[idx + 2 * width] += err;
            }
        }

        // Step 4: write the result back into the pixel array
        for (let i = 0; i < totalPixels; i++) {
            const val = Math.min(255, Math.max(0, sharpBuf[i]));
            const px = i * 4;
            data[px]     = val;
            data[px + 1] = val;
            data[px + 2] = val;
            data[px + 3] = 255;
        }

        return imageData;
    }
}

/**
 * Loading, rasterising and re-encoding - everything around EinkProcessor that needs
 * a document to work with. Used from the offscreen document on Chromium, from the
 * background page on Firefox, and from the popup for the live cover preview.
 */
class EinkImages {
    /**
     * Same proxy Epub.proxyUrl points at. It is repeated here because the popup
     * runs the preview without loading the epub code - keep the two in step.
     */
    static proxyUrl = 'https://images.instabook.site/cors-proxy.php?url=';

    /** an image that never loads would otherwise leave the conversion hanging */
    static loadTimeout = 15000;

    /** processed covers, so that switching back and forth is instant */
    static cache = new Map();
    static maxCacheEntries = 12;

    /**
     * Loads an image, processes it and gives back a PNG blob. PNG rather than JPEG
     * because the dithered dot pattern is exactly the kind of detail JPEG throws away.
     *
     * @param url
     * @param mode
     * @param {?string} mimeType content type of the source image, when it is known
     * @returns {Promise<Blob>}
     */
    static async toBlob(url, mode, mimeType = null) {
        const canvas = await EinkImages.renderProcessed(url, mode, mimeType, false);
        return await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('the processed image could not be encoded'));
                }
            }, 'image/png');
        });
    }

    /**
     * The same thing as a data url, which is what a CSS background needs.
     *
     * @param url
     * @param mode
     * @returns {Promise<string>}
     */
    static async toDataUrl(url, mode) {
        const key = EinkImages.cacheKey(url, mode);
        if (EinkImages.cache.has(key)) {
            return EinkImages.cache.get(key);
        }
        const canvas = await EinkImages.renderProcessed(url, mode, null, true),
            dataUrl = canvas.toDataURL('image/png');
        if (EinkImages.cache.size >= EinkImages.maxCacheEntries) {
            EinkImages.cache.delete(EinkImages.cache.keys().next().value);
        }
        EinkImages.cache.set(key, dataUrl);
        return dataUrl;
    }

    /**
     * The already processed version of an image, when there is one. Lets the caller
     * swap a cover over without a flash of the unprocessed picture in between.
     *
     * @param url
     * @param mode
     * @returns {?string}
     */
    static cachedDataUrl(url, mode) {
        const key = EinkImages.cacheKey(url, mode);
        return EinkImages.cache.has(key) ? EinkImages.cache.get(key) : null;
    }

    static cacheKey(url, mode) {
        return EinkProcessor.normalizeMode(mode) + '|' + url;
    }

    static async renderProcessed(url, mode, mimeType, allowProxyFallback) {
        const image = await EinkImages.loadImage(url, allowProxyFallback),
            isVector = mimeType === 'image/svg+xml' || url.startsWith('data:image/svg+xml');
        return EinkImages.processCanvas(EinkImages.drawToCanvas(image, isVector), mode);
    }

    /**
     * Runs the pixel work over a canvas that has already been drawn on. The cover is
     * built this way - it is composed first and optimised afterwards, so that the
     * title printed on it goes through the same treatment as the picture behind it.
     *
     * @param canvas
     * @param mode
     * @returns {HTMLCanvasElement}
     */
    static processCanvas(canvas, mode) {
        if (!EinkProcessor.isEnabled(mode)) {
            return canvas;
        }
        const context = canvas.getContext('2d'),
            imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        EinkProcessor.processImageData(imageData, EinkProcessor.optionsForMode(mode));
        context.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Draws the image onto a white canvas at the size it is going to be dithered at.
     *
     * @param image
     * @param isVector
     * @returns {HTMLCanvasElement}
     */
    static drawToCanvas(image, isVector = false) {
        let width = image.naturalWidth || image.width || 0,
            height = image.naturalHeight || image.height || 0;
        // an svg with no width, height or viewBox reports no size at all
        if (width === 0 || height === 0) {
            width = 800;
            height = 600;
        }
        let scale = isVector ? EinkProcessor.vectorScale : 1;
        const longestSide = Math.max(width, height) * scale;
        if (longestSide > EinkProcessor.maxImageSize) {
            scale *= EinkProcessor.maxImageSize / longestSide;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        // transparency has to land on white before anything measures its brightness
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    /**
     * Pixels can only be read back from a canvas the image was allowed to taint, so
     * everything is requested with CORS. Article images are already fetched through
     * the proxy, which answers with the header that needs; the popup passes its own
     * urls untouched and falls back to the proxy only when the site refuses.
     *
     * @param url
     * @param allowProxyFallback
     * @returns {Promise<HTMLImageElement>}
     */
    static loadImage(url, allowProxyFallback = false) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            let usedProxy = false, settled = false;
            const finish = (callback) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                callback();
            };
            const timeout = setTimeout(
                () => finish(() => reject(new Error('the image timed out: ' + url))),
                EinkImages.loadTimeout
            );
            image.crossOrigin = 'anonymous';
            image.onload = () => finish(() => resolve(image));
            image.onerror = () => {
                if (!usedProxy && allowProxyFallback && EinkImages.canBeProxied(url)) {
                    usedProxy = true;
                    image.src = EinkImages.proxyUrl + encodeURIComponent(url);
                    return;
                }
                finish(() => reject(new Error('the image could not be loaded: ' + url)));
            };
            image.src = url;
        });
    }

    static canBeProxied(url) {
        return /^https?:\/\//i.test(url) && url.indexOf(EinkImages.proxyUrl) !== 0;
    }
}
