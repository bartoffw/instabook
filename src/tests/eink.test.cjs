/**
 * Tests for the e-ink image optimisation.
 *
 * Only EinkProcessor.processImageData is exercised here - it is the part that does
 * the actual work on the pixels and the only one that needs nothing but an array of
 * them. Everything around it (loading an image, drawing it onto a canvas, encoding
 * the result) needs a browser and is left to manual testing.
 *
 * Run with `npm test` from the src folder.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'eink.js'), 'utf8');
const EinkProcessor = new Function(source + '\nreturn EinkProcessor;')();

let failures = 0, checks = 0;

function check(name, condition, detail) {
    checks++;
    if (condition) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? '\n         ' + detail : ''));
    }
}

/**
 * A stand-in for the browser's ImageData - processImageData only ever reads the
 * width, the height and the pixel array.
 */
function imageData(width, height, pixel) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const rgba = pixel(x, y), at = (y * width + x) * 4;
            data[at] = rgba[0];
            data[at + 1] = rgba[1];
            data[at + 2] = rgba[2];
            data[at + 3] = rgba.length > 3 ? rgba[3] : 255;
        }
    }
    return { width: width, height: height, data: data };
}

function solid(width, height, rgba) {
    return imageData(width, height, () => rgba);
}

function pixelAt(result, x, y) {
    const at = (y * result.width + x) * 4;
    return [ result.data[at], result.data[at + 1], result.data[at + 2], result.data[at + 3] ];
}

function allPixels(result) {
    let values = [];
    for (let i = 0; i < result.data.length; i += 4) {
        values.push(result.data[i]);
    }
    return values;
}

function isGrey(result) {
    for (let i = 0; i < result.data.length; i += 4) {
        if (result.data[i] !== result.data[i + 1] || result.data[i] !== result.data[i + 2]) {
            return false;
        }
    }
    return true;
}

console.log('\n-- the modes --');
check('an unknown mode reads as full colour',
    EinkProcessor.normalizeMode('sepia') === 'color');
check('a missing mode reads as full colour',
    EinkProcessor.normalizeMode(undefined) === 'color');
check('grayscale and mono are kept',
    EinkProcessor.normalizeMode('grayscale') === 'grayscale' &&
    EinkProcessor.normalizeMode('mono') === 'mono');
check('only the e-ink modes count as enabled',
    !EinkProcessor.isEnabled('color') &&
    EinkProcessor.isEnabled('grayscale') && EinkProcessor.isEnabled('mono'));
check('mono asks for a 1-bit palette, grayscale for 16 levels',
    EinkProcessor.paletteMode('mono') === '1-bit' &&
    EinkProcessor.paletteMode('grayscale') === '16-level');

console.log('\n-- what comes out --');
let result = EinkProcessor.processImageData(
    imageData(24, 24, (x, y) => [ (x * 10) % 256, (y * 10) % 256, 128 ]),
    EinkProcessor.optionsForMode('grayscale')
);
check('colour is gone - every pixel is a shade of grey', isGrey(result));
check('nothing is left transparent',
    allPixels(result).every((value, index) => result.data[index * 4 + 3] === 255));
check('the picture keeps its size', result.width === 24 && result.height === 24);

const levels = new Set(allPixels(result));
check('16 shades at most are used, and they sit on the palette',
    levels.size <= 16 && [...levels].every((value) => Math.abs(value % 17) < 0.5),
    'got ' + [...levels].sort((a, b) => a - b).join(', '));

result = EinkProcessor.processImageData(
    imageData(24, 24, (x, y) => [ (x * 10) % 256, (y * 10) % 256, 128 ]),
    EinkProcessor.optionsForMode('mono')
);
check('mono leaves nothing but black and white',
    allPixels(result).every((value) => value === 0 || value === 255),
    'got ' + [...new Set(allPixels(result))].join(', '));

console.log('\n-- the flat areas Atkinson is chosen for --');
result = EinkProcessor.processImageData(solid(16, 16, [255, 255, 255]), EinkProcessor.optionsForMode('grayscale'));
check('a white background comes back white, with no speckle',
    allPixels(result).every((value) => value === 255));

result = EinkProcessor.processImageData(solid(16, 16, [0, 0, 0]), EinkProcessor.optionsForMode('grayscale'));
check('a black area comes back black',
    allPixels(result).every((value) => value === 0));

result = EinkProcessor.processImageData(solid(16, 16, [255, 255, 255]), EinkProcessor.optionsForMode('mono'));
check('a white background stays white in mono too',
    allPixels(result).every((value) => value === 255));

console.log('\n-- transparency --');
// fully transparent pixels have to be read as white, or a chart with no background
// of its own turns into a dark grey box
result = EinkProcessor.processImageData(solid(16, 16, [0, 0, 0, 0]), EinkProcessor.optionsForMode('grayscale'));
check('a transparent area is blended onto white rather than onto black',
    allPixels(result).every((value) => value === 255),
    'got ' + [...new Set(allPixels(result))].join(', '));

console.log('\n-- isoluminant colours, the reason this exists --');
// red and green come out as the same grey under the plain luminance formula, which
// is what makes a two-line chart unreadable. They cannot be told apart by tone, but
// the gamma curve still has to keep them off the same value as the background.
const red = EinkProcessor.processImageData(solid(8, 8, [220, 0, 0]), { gamma: 1.8, sharpen: false, mode: '16-level' });
check('a strong colour does not collapse into the white background',
    allPixels(red).every((value) => value < 255));

console.log('\n-- the gamma curve --');
const plain = EinkProcessor.processImageData(solid(8, 8, [128, 128, 128]), { gamma: 1.0, sharpen: false, mode: '16-level' }),
    corrected = EinkProcessor.processImageData(solid(8, 8, [128, 128, 128]), { gamma: 1.8, sharpen: false, mode: '16-level' });
check('gamma lifts the midtones, which is what an e-ink panel needs',
    pixelAt(corrected, 0, 0)[0] > pixelAt(plain, 0, 0)[0],
    'gamma 1.8 gave ' + pixelAt(corrected, 0, 0)[0] + ', no correction gave ' + pixelAt(plain, 0, 0)[0]);

console.log('\n-- sharpening --');
// a single dark line on a light background is the chart axis case: it has to survive
const lineOptions = { gamma: 1.8, sharpen: true, mode: '16-level' },
    withLine = EinkProcessor.processImageData(
        imageData(9, 9, (x) => x === 4 ? [90, 90, 90] : [235, 235, 235]), lineOptions
    );
check('a thin line is still there after quantisation',
    pixelAt(withLine, 4, 4)[0] < pixelAt(withLine, 1, 4)[0],
    'line ' + pixelAt(withLine, 4, 4)[0] + ', background ' + pixelAt(withLine, 1, 4)[0]);

console.log('\n-- awkward sizes --');
check('a single pixel does not throw', (() => {
    try {
        EinkProcessor.processImageData(solid(1, 1, [10, 200, 30]), EinkProcessor.optionsForMode('grayscale'));
        return true;
    } catch (error) {
        return false;
    }
})());
check('a one pixel wide column does not throw', (() => {
    try {
        EinkProcessor.processImageData(solid(1, 20, [10, 200, 30]), EinkProcessor.optionsForMode('mono'));
        return true;
    } catch (error) {
        return false;
    }
})());

console.log('\n' + (failures === 0 ?
    'All ' + checks + ' checks passed' :
    failures + ' of ' + checks + ' checks failed'));
process.exit(failures === 0 ? 0 : 1);
