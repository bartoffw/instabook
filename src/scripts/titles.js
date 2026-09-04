/**
 * Shortening of the repeating parts of the chapter titles.
 *
 * Pages of the same site almost always carry the site name in their title, either
 * in front of the article name or behind it ("Some article - My Blog"). With many
 * chapters in one Ebook that repeated part is just noise, so it is cut away.
 *
 * Everything here is plain string handling with no DOM and no browser API behind it,
 * so it can be exercised on its own - see src/tests/titles.test.cjs.
 */
class Titles {

    /**
     * The text that separates the parts of a page title.
     *
     * A dash, a tilde or a slash only counts when it has spaces on both sides, so
     * that "state-of-the-art" or "and/or" is not mistaken for one. The full width
     * punctuation is used without any spacing around it, as Japanese and Chinese
     * titles don't separate words with spaces.
     *
     * A fresh regular expression is returned on every read, as the global flag
     * makes the object remember where the previous search ended.
     */
    static get separator() {
        return /(?:\s+[-~/]+\s+)|(?:\s*[|•·»–—]+\s+)|(?::\s+)|(?:\s*[｜│：・]\s*)/g;
    }

    /** the repeating part has to hold at least this many characters of actual text */
    static minRepeatedLength = 3;

    /**
     * Cuts the part repeating across the given titles - the site name most of the
     * time - off the end and off the beginning of each of them.
     *
     * A title that doesn't share the repeated part is left as it is, and no title is
     * ever shortened to nothing, so a mixed set of chapters degrades into fewer
     * titles being shortened instead of into nonsense.
     *
     * @param titles list of the chapter titles
     * @returns {string[]} the shortened titles, in the same order
     */
    static shortenTitles(titles) {
        let result = Array.isArray(titles) ?
            titles.map((title) => typeof title === 'string' ? title : '') : [];
        if (result.length < 2) {
            return result;
        }
        for (const fromEnd of [true, false]) {
            const repeated = Titles.findRepeatedPart(result, fromEnd);
            if (repeated.length > 0) {
                result = result.map((title) => Titles.canCut(title, repeated, fromEnd) ?
                    Titles.cut(title, repeated, fromEnd) : title);
            }
        }
        return result;
    }

    /**
     * Finds the longest part shared by enough of the titles to call it a repetition.
     * At least half of them have to carry it, and never fewer than two.
     *
     * @param titles list of the chapter titles
     * @param fromEnd looking at the end of the titles instead of their beginning
     * @returns {string} the repeating part, an empty string when there is none
     */
    static findRepeatedPart(titles, fromEnd) {
        const minCount = Math.max(2, Math.ceil(titles.length / 2));
        let best = '', bestCount = 0, checked = new Set();
        for (const title of titles) {
            for (const candidate of Titles.cutCandidates(title, fromEnd)) {
                if (checked.has(candidate)) {
                    continue;
                }
                checked.add(candidate);
                const count = titles.filter((other) => Titles.canCut(other, candidate, fromEnd)).length;
                if (count >= minCount &&
                    (count > bestCount || (count === bestCount && candidate.length > best.length))) {
                    best = candidate;
                    bestCount = count;
                }
            }
        }
        return best;
    }

    /**
     * Every place the title can be cut at, expressed as the text that would go away.
     * The cut always happens on a separator, so that no word is ever cut in half.
     *
     * @param title
     * @param fromEnd looking at the end of the title instead of its beginning
     * @returns {string[]}
     */
    static cutCandidates(title, fromEnd) {
        let candidates = [];
        for (const match of title.matchAll(Titles.separator)) {
            const candidate = fromEnd ?
                title.substring(match.index) :
                title.substring(0, match.index + match[0].length);
            if (candidate.length < title.length &&
                Titles.repeatedTextLength(candidate) >= Titles.minRepeatedLength) {
                candidates.push(candidate);
            }
        }
        return candidates;
    }

    /**
     * Tells whether the part can be cut off the title while leaving something behind.
     *
     * @param title
     * @param part
     * @param fromEnd cutting the end of the title instead of its beginning
     * @returns {boolean}
     */
    static canCut(title, part, fromEnd) {
        if (!(fromEnd ? title.endsWith(part) : title.startsWith(part))) {
            return false;
        }
        return Titles.cut(title, part, fromEnd).length > 0;
    }

    /**
     * Cuts the part off the title and tidies up the separator left behind.
     *
     * @param title
     * @param part
     * @param fromEnd cutting the end of the title instead of its beginning
     * @returns {string}
     */
    static cut(title, part, fromEnd) {
        return Titles.trimSeparators(fromEnd ?
            title.substring(0, title.length - part.length) :
            title.substring(part.length));
    }

    /**
     * The amount of actual text a part holds, with the separators not counted in.
     *
     * @param part
     * @returns {number}
     */
    static repeatedTextLength(part) {
        return part.replace(Titles.separator, '').trim().length;
    }

    /**
     * Removes the whitespace and the dangling separators from both ends of the text.
     *
     * @param text
     * @returns {string}
     */
    static trimSeparators(text) {
        return text
            .replace(/^[\s\-~/|:•·»–—｜│：・]+/, '')
            .replace(/[\s\-~/|:•·»–—｜│：・]+$/, '');
    }
}
