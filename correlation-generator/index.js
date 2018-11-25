var redis = require('redis');

exports.getCorrelation = function(userToken, town, typesCount, perTypeCount, redisClient, callback) {

    var errSet = false;

    redisClient.hgetall(`user:${userToken}:types`, (err, res) => {

        if (errSet) {
            return;
        }

        if (err || !res) {

            errSet = true;
            console.log(err);
            callback(err, null);
            return;
        }

        var callbackResult = [];

        var typesProcessed = 0;
        var types = Object.keys(res);
        types = types.sort((key1, key2) => parseFloat(res[key2]) - parseFloat(res[key1])).slice(0, typesCount);
        console.log(`RES user_types is: ${types}`);
        types.forEach(type => {

            redisClient.hget(`${town}:places`, type, (err, res) => {

                if (errSet) {
                    return;
                }

                if (err) {

                    errSet = true;
                    console.log(err);
                    callback(err, null);
                    return;
                }

                if (!res) {
                    return;
                }

                try {

                    var placesProcessed = 0;
                    var places = JSON.parse(res).map(placeId => {
                        return {
                            id: placeId,
                            score: 0
                        };
                    });

                    places.forEach(place => {

                        var subtypesProcessed = 0;
                        redisClient.hkeys(`place:${place.id}:subtypes`, (err, res) => {

                            if (errSet) {
                                return;
                            }

                            if (err) {

                                errSet = true;
                                console.log(err);
                                callback(err, null);
                                return;
                            }

                            if (!res) {

                                if (++placesProcessed === places.length) {

                                    places.sort((place1, place2) => place2.score - place1.score);
                                    callbackResult.concat(places.slice(0, perTypeCount).map(place => place.id));

                                    if (++typesProcessed === types.length) {
                                        callback(null, callbackResult);
                                    }
                                }
                                return; 
                            }

                            res.forEach(subtype => {

                                redisClient.hget(`user:${userToken}:subtypes`, subtype, (err, res) => {

                                    var score = 0;
                                    if (res) {
                                        score = parseFloat(res);
                                    }
                                    place.score += score;
                                    
                                    if (++subtypesProcessed === res.length) {
                                        
                                        if (++placesProcessed === places.length) {

                                            places.sort((place1, place2) => place2.score - place1.score);
                                            callbackResult.concat(places.slice(0, perTypeCount).map(place => place.id));

                                            if (++typesProcessed === types.length) {
                                                callback(null, callbackResult);
                                            }
                                        }
                                    }
                                });
                            });
                        });
                    });

                } catch (e) {

                    errSet = true;
                    console.log(e);
                    callback(err, null);
                }
            });
        });
    });
}