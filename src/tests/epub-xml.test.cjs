/**
 * Tests for the escaping of the text that goes into the generated EPUB files.
 *
 * Those files are XML, so a single unescaped ampersand in a page title is enough
 * to stop a reader from opening the book at all.
 *
 * Run with `npm test` from the src folder. Only Epub.escapeXml is exercised here,
 * as it is the one piece that needs no document around it.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'epub.js'), 'utf8');
const Epub = new Function(source + '\nreturn Epub;')();

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

function expectEscaped(name, input, expected) {
    const actual = Epub.escapeXml(input);
    check(name, actual === expected, 'expected ' + JSON.stringify(expected) +
        '\n         got      ' + JSON.stringify(actual));
}

console.log('\n-- the characters XML cares about --');
expectEscaped('an ampersand', 'Tom & Jerry', 'Tom &amp; Jerry');
expectEscaped('a less than sign', 'a < b', 'a &lt; b');
expectEscaped('a greater than sign', 'a > b', 'a &gt; b');
expectEscaped('a double quote', 'the "best" way', 'the &quot;best&quot; way');
expectEscaped('a single quote', "it's here", 'it&#39;s here');
expectEscaped('all of them at once', `<a href="x">&'`, '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');

console.log('\n-- text that must not change --');
expectEscaped('plain text', 'The best way to make coffee', 'The best way to make coffee');
expectEscaped('japanese text', '九州新幹線が全線で運転を再開', '九州新幹線が全線で運転を再開');
expectEscaped('an empty string', '', '');

console.log('\n-- awkward input --');
expectEscaped('null becomes an empty string', null, '');
expectEscaped('undefined becomes an empty string', undefined, '');
expectEscaped('a number is turned into text', 42, '42');
expectEscaped('an already escaped entity is escaped again', '&amp;', '&amp;amp;');

console.log('\n-- the results parse as XML --');
const nasty = 'Tom & Jerry: <b>"the best"</b> of it\'s kind';
const asElementText = '<x>' + Epub.escapeXml(nasty) + '</x>';
const asAttribute = '<x a="' + Epub.escapeXml(nasty) + '" />';
check('nothing but entities is left of the markup',
    !/[<>]/.test(Epub.escapeXml(nasty).replace(/&(amp|lt|gt|quot|#39);/g, '')),
    Epub.escapeXml(nasty));
check('an escaped value closes no element early', asElementText.indexOf('</x>') === asElementText.length - 4);
check('an escaped value closes no attribute early', asAttribute.split('"').length === 3, asAttribute);

console.log('\n' + (failures === 0 ?
    'All ' + checks + ' checks passed' :
    failures + ' of ' + checks + ' checks failed'));
process.exit(failures === 0 ? 0 : 1);
