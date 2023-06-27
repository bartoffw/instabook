document.addEventListener('click', (event) => {
    if (event.target.id === 'convert-btn') {
        console.log('Convert!');

        browser.tabs.query({currentWindow: true, active: true})
            .then((tabs) => {
                //title
                //url
                //console.log(tabs[0]);
                browser.tabs
                    .sendMessage(tabs[0].id, 'get')
                    .then(response => {
                        browser.runtime.sendMessage({
                            type: 'convert',
                            title: tabs[0].title,
                            url: tabs[0].url,
                            html: response
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
