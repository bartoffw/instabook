/**
 * Tests for the chapter title shortening (the "Shorten repeatable titles" setting).
 *
 * Run with `npm test` from the src folder. The tested file is a plain browser script,
 * so it is loaded here by evaluating it instead of importing it.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'titles.js'), 'utf8');
const Titles = new Function(source + '\nreturn Titles;')();

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
 * Runs the shortening over the titles and compares the result with the expected one.
 * An expected entry of null means the title has to come back untouched.
 */
function expectTitles(name, titles, expected) {
    const actual = Titles.shortenTitles(titles);
    const wanted = expected.map((value, index) => value === null ? titles[index] : value);
    const same = actual.length === wanted.length && actual.every((value, i) => value === wanted[i]);
    check(name, same, same ? '' :
        'expected ' + JSON.stringify(wanted) + '\n         got      ' + JSON.stringify(actual));
}

console.log('\n-- the site name at the end --');
expectTitles('a dash separated site name is cut off', [
    'The best way to make coffee - My Coffee Blog',
    'Grinding beans at home - My Coffee Blog',
    'A short guide to espresso - My Coffee Blog'
], [
    'The best way to make coffee',
    'Grinding beans at home',
    'A short guide to espresso'
]);

expectTitles('a pipe separated site name is cut off', [
    'Markets slide on new data | Example News',
    'Central bank holds rates | Example News',
    'What the numbers mean | Example News'
], [
    'Markets slide on new data',
    'Central bank holds rates',
    'What the numbers mean'
]);

expectTitles('an en dash separated site name is cut off', [
    'A walk through the old town – Travel Notes',
    'Where to eat in the old town – Travel Notes'
], [
    'A walk through the old town',
    'Where to eat in the old town'
]);

expectTitles('two chapters are enough', [
    'Chapter one of the story - Fiction Corner',
    'Chapter two of the story - Fiction Corner'
], [
    'Chapter one of the story',
    'Chapter two of the story'
]);

console.log('\n-- the site name at the beginning --');
expectTitles('a leading site name is cut off', [
    'My Coffee Blog - The best way to make coffee',
    'My Coffee Blog - Grinding beans at home',
    'My Coffee Blog - A short guide to espresso'
], [
    'The best way to make coffee',
    'Grinding beans at home',
    'A short guide to espresso'
]);

expectTitles('a leading series name with a colon is cut off', [
    'Python tutorial: working with lists',
    'Python tutorial: working with dictionaries',
    'Python tutorial: writing your first class'
], [
    'working with lists',
    'working with dictionaries',
    'writing your first class'
]);

expectTitles('both ends are cut off', [
    'Example News | Markets slide on new data | Europe',
    'Example News | Central bank holds rates | Europe',
    'Example News | What the numbers mean | Europe'
], [
    'Markets slide on new data',
    'Central bank holds rates',
    'What the numbers mean'
]);

console.log('\n-- nothing to cut --');
expectTitles('unrelated titles are left alone', [
    'How to bake sourdough bread at home',
    'The history of the Roman aqueducts',
    'Why the sky looks blue at noon'
], [null, null, null]);

expectTitles('a hyphen inside a word is not a separator', [
    'A state-of-the-art kitchen setup',
    'The state-of-the-art of espresso'
], [null, null]);

expectTitles('a slash inside a word is not a separator', [
    'Notes on TCP/IP for beginners',
    'More notes on TCP/IP routing'
], [null, null]);

expectTitles('a single chapter is left alone', [
    'The best way to make coffee - My Coffee Blog'
], [null]);

expectTitles('an empty list is handled', [], []);

expectTitles('a repeated part of one or two letters is not worth cutting', [
    'The first part - AP',
    'The second part - AP'
], [null, null]);

console.log('\n-- partial and awkward sets --');
expectTitles('a chapter from another site keeps its title', [
    'The best way to make coffee - My Coffee Blog',
    'Grinding beans at home - My Coffee Blog',
    'An unrelated article on another website'
], [
    'The best way to make coffee',
    'Grinding beans at home',
    null
]);

expectTitles('a part shared by too few chapters is not cut', [
    'One - My Coffee Blog',
    'Two - Something Else',
    'Three - Third Site',
    'Four - Fourth Site',
    'Five - Fifth Site',
    'Six - Sixth Site'
], [null, null, null, null, null, null]);

expectTitles('a title made of nothing but the repeated part survives', [
    'My Coffee Blog',
    'Grinding beans at home - My Coffee Blog',
    'A short guide to espresso - My Coffee Blog'
], [
    null,
    'Grinding beans at home',
    'A short guide to espresso'
]);

expectTitles('identical titles are left alone', [
    'My Coffee Blog',
    'My Coffee Blog'
], [null, null]);

expectTitles('the longer of two shared endings wins', [
    'Beans - Brewing guide - My Coffee Blog',
    'Water - Brewing guide - My Coffee Blog',
    'Grinders - Brewing guide - My Coffee Blog'
], [
    'Beans',
    'Water',
    'Grinders'
]);

console.log('\n-- non latin titles --');
expectTitles('a full width pipe separates japanese titles', [
    '九州新幹線が全線で運転を再開｜やさしい日本語',
    '台風のあとで電車が止まりました｜やさしい日本語'
], [
    '九州新幹線が全線で運転を再開',
    '台風のあとで電車が止まりました'
]);

expectTitles('a spaced pipe separates japanese titles too', [
    '九州新幹線が全線で運転を再開 | やさしい日本語',
    '台風のあとで電車が止まりました | やさしい日本語'
], [
    '九州新幹線が全線で運転を再開',
    '台風のあとで電車が止まりました'
]);

console.log('\n-- the pieces on their own --');
check('cutCandidates cuts only on separators',
    JSON.stringify(Titles.cutCandidates('The best way - My Coffee Blog', true)) ===
        JSON.stringify([' - My Coffee Blog']));
check('cutCandidates finds every separator of a title',
    Titles.cutCandidates('One - Two - Three Blog', true).length === 2,
    JSON.stringify(Titles.cutCandidates('One - Two - Three Blog', true)));
check('canCut refuses to empty a title',
    Titles.canCut('My Coffee Blog', 'My Coffee Blog', true) === false);
check('cut tidies up the separator left behind',
    Titles.cut('Grinding beans - My Coffee Blog', ' - My Coffee Blog', true) === 'Grinding beans');
check('trimSeparators strips a dangling separator',
    Titles.trimSeparators('  - Grinding beans |') === 'Grinding beans');
check('the separator regex does not carry state between calls',
    Titles.cutCandidates('One - My Coffee Blog', true).length ===
        Titles.cutCandidates('One - My Coffee Blog', true).length);
check('shortenTitles survives a non string entry',
    Array.isArray(Titles.shortenTitles([null, undefined, 5])));

console.log('\n' + (failures === 0 ?
    'All ' + checks + ' checks passed' :
    failures + ' of ' + checks + ' checks failed'));
process.exit(failures === 0 ? 0 : 1);
