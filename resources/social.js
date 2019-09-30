var social = {

    facebook: {

        url: "https://www.facebook.com/dialog/share",

        params: {
            app_id: analyticsConfig.facebook,
            href: "https://octo.bestmacsoft.com",
            redirect_uri: "",
            display: "popup",
            mobile_iframe: "false",

            quote: "Just installed Octo. It really is a great way to organize your messengers",
        }

    },

    twitter: {

        url: "https://twitter.com/intent/tweet",

        params: {
            url: "https://octo.bestmacsoft.com",
            via: "Octo_messenger",

            text: "Just installed Octo. It really is a great way to organize your messengers",
        }
    },

}

// Generate Share links
var socialEncoded = function () {

    var obj = {}

    for (var s in social) {

        var str = social[s].url + "?"
        for (var p in social[s].params) {

            str += p + "=" + encodeURIComponent(social[s].params[p]) + "&"
        }

        obj[s] = str
    }

    return obj
}();
