<?php
/**
 * From: https://gist.github.com/dropmeaword/a050231a5767adc52b986faf587f64c9
 * Modified
 */

error_reporting(error_reporting() & ~E_NOTICE); // evil

// config
$valid_url_regex = '/.*/';
$status = [];

// ############################################################################

$url = $_GET['url'];

if (!$url) {

    // Passed url not specified.
    $contents = 'ERROR: url not specified';
    $status = array('http_code' => 'ERROR');

} else if (!preg_match($valid_url_regex, $url)) {

    // Passed url doesn't match $valid_url_regex.
    $contents = 'ERROR: invalid url';
    $status = array('http_code' => 'ERROR');

} else {
    if (str_starts_with($url, 'moz-extension:')) {
        $url = str_replace('moz-extension:', 'https:', $url);
    }

    $ch = curl_init($url);

    // @lf get domain from url and keep it around
    $parts = parse_url($url);
    $domain = $parts['scheme']."://".$parts['host'];

    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_ENCODING ,""); // @lf guess encoding automagically
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    curl_setopt($ch, CURLOPT_USERAGENT, $_GET['user_agent'] ? $_GET['user_agent'] : $_SERVER['HTTP_USER_AGENT']);

    list($header, $contents) = preg_split('/([\r\n][\r\n])\\1/', curl_exec($ch), 2);

    // @lf filter any relative urls and replace them with absolute urls
    $rep['/href="(?!https?:\/\/)(?!data:)(?!#)/'] = 'href="'.$domain;
    $rep['/src="(?!https?:\/\/)(?!data:)(?!#)/'] = 'src="'.$domain;
    $rep['/href=\'(?!https?:\/\/)(?!data:)(?!#)/'] = 'href="'.$domain;
    $rep['/src=\'(?!https?:\/\/)(?!data:)(?!#)/'] = 'src="'.$domain;
    $rep['/@import[\n+\s+]"\//'] = '@import "'.$domain;
    $rep['/@import[\n+\s+]"\./'] = '@import "'.$domain;
    // @lf warning: clears previous contents
    $contents = preg_replace(array_keys($rep), array_values($rep), $contents);

    $status = curl_getinfo($ch);

    curl_close($ch);
}

if (!empty($status['http_code']) && $status['http_code'] === 'ERROR') {
    http_response_code(400);
    die($contents);
}

// Split header text into an array.
$header_text = preg_split('/[\r\n]+/', $header);

// Propagate headers to response.
foreach ($header_text as $header) {
    if (preg_match('/^(?:Content-Type|Content-Language|Set-Cookie):/i', $header)) {
        header($header);
    }
    header('Access-Control-Allow-Origin: *');
}

echo $contents;
