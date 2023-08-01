document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        console.log('Convert!');

        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'get' })
                    .then(response => {
                        //console.log(response.iframes);
                        browser.runtime.sendMessage({
                            type: 'convert',
                            title: tabs[0].title,
                            url: tabs[0].url,
                            html: response.html,
                            iframes: response.iframes,
                            images: response.images
                        });
                    })
                    .catch(error => {
                        console.error('Error on send message: ' + error)
                    });
            })
            .catch(error => {
                console.error('Error on tab query: ' + error)
            });
    }
    else if (event.target.id === 'reset-btn') {
        console.log('Reset!');
    }
});

function reportExecuteScriptError(error) {
    // document.querySelector("#popup-content").classList.add("d-none");
    // document.querySelector("#error-content").classList.remove("d-none");
    console.error(`Failed to execute the content script: ${error.message}`);
}

browser.tabs
    .query({ currentWindow: true, active: true })
    .then((tabs) => {
        const pageUrl = tabs[0].url,
            pageTitle = tabs[0].title;
        $("#page-title").text(pageTitle);
        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                browser.tabs
                    .sendMessage(tabs[0].id, { type: 'images' })
                    .then(response => {
                        $('#time-field').html(response.readTime.minutes + ' minutes');
                        if (response.cover.length > 0) {
                            $('<img/>').attr('src', response.cover).on('load', () => {
                                $(this).remove();
                                $('.bg-image').css('background-image', 'url(' + response.cover + ')');
                                //$('#convert-btn').prop('disabled', false);
                            });
                        } /*else {
                            $('#convert-btn').prop('disabled', false);
                        }*/
                        $('#url-field').html('<a href="' + pageUrl + '">' + (new URL(pageUrl)).hostname + '</a>');
                        let imgLeft = response.images.length;
                        for (let i = 0; i < response.images.length; i++) {
                            let imgUrl = response.images[i];
                            $('<img/>').attr('src', imgUrl).on('load', () => {
                                //$(this).remove();
                                imgLeft--;
                                if (imgLeft <= 0) {
                                    $('#convert-btn').prop('disabled', false);
                                }
                            });
                        }
                    })
                    .catch(error => {
                        console.error('Error on send message: ' + error)
                    });
            })
            .catch(error => {
                console.error('Error on tab query: ' + error)
            });
    }, reportExecuteScriptError);