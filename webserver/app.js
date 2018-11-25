var express = require('express')
var redis = require('redis')
var app = express()
var fb = require("./fb.js")
var google_places = require("../gmaps/places.js")
var correlation_gen = require("../correlation-generator/index.js")
var top_subcategories = require("../top-categories")
const port = 8000

redis_client = redis.createClient();
redis_client.on('error', function (err) {
  console.log('Error ' + err)
})

function initRedisUsers() {
  client.get("users", function(err, response) {
    if (response == null) {}
  });
}

function saveUserLogin(user_login, user_info, cb) {
  redis_client.hget('users', user_info.id, function(err, res) {
    if (res == null) {
      redis_client.hset('users', user_info.id, JSON.stringify({'name':user_info.name, 'email':user_info.email, 'access_token':user_login.user_token}))
      cb(null, true);
    } else {
      cb(null, false);
    }
  });
}

function saveUserTags(user_id, places_tags, cb) {
  tag_types = places_tags.types
  tag_subtypes = places_tags.subtypes
  Object.keys(tag_types).forEach((type) => {
    redis_client.hset('user:' + user_id + ':types', type, tag_types[type])
  });
  Object.keys(tag_subtypes).forEach((subtype) => {
    redis_client.hset('user:' + user_id + ':subtypes', subtype, tag_subtypes[subtype])
  });
  cb();
}

function saveSearch(user_id, place_string) {

}

function savePlaces(user_id, place_string, places, cb) {
  saveSearch(user_id, place_string)
  redis_client.keys(place_string+':google_places', function(err, res) {
    if (res.length == 0) {
      places_ids = places.places
      inverted_places_ids = places[place_string+':places']
      Object.keys(places_ids).forEach((place_id) => {
        places_ids[place_id].types.forEach((type) => {
          redis_client.hset('place:' + place_id + ':types', type, "")
        });
        places_ids[place_id].subtypes.forEach((subtype) => {
          redis_client.hset('place:' + place_id + ':subtypes', subtypes, "")
        });
        redis_client.hset(place_string+':google_places', place_id, JSON.stringify(places_ids[place_id].raw_json))
      });
      Object.keys(inverted_places_ids).forEach((type) => {
        redis_client.hset(place_string+':places', type, JSON.stringify(inverted_places_ids[type]))
      });
    }
  })
  cb();
}

app.use(function (req, res, next) {
  res.header("Content-Type",'application/json;charset=utf-8');
  next();
});

app.get('/status', function (req, res) {
  res.send({'status':'OK'})
})

app.get('/recent_searches', function (req,res) {
  if (req.query.user_id == null) {
    res.sendStatus("401");
    res.send("Unauthorized access for /search_place endpoint!");
  } else {
    getRecentSearches(req.query.user_id, function(err, recent_searches) {
      if (err) {
        console.log(err)
        res.send(err)
      }
      console.log(recent_searches)
      res.json(recent_searches)
    });
  }
});

app.get('/search_place', function(req, res) {
  if (req.query.user_id == null) {
    res.sendStatus("401");
    res.send("Unauthorized access for /search_place endpoint!");
  } else {
    if (req.query.place_string == null) {
      res.sendStatus("400");
      res.send("Bad request! Missing place_string param.")
    } else {
      var place_string = req.query.place_string
      google_places.getPlaces(place_string, function(err, places) {
        console.log(places)
        savePlaces(req.query.user_id, place_string, places, function(err) {
          correlation_gen.getCorrelation(req.query.user_id, place_string, 5, 10, redis_client, function(err, result) {
            if (err) {
              console.log(err)
              res.send(err)
            } else {
              console.log(result)
              //res.json(result)
            }
          });
          res.end()
        });
      });
    }
    console.log('Got a GET request at /search_place with token: ' + req.query.user_token + ' and place_string: ' + req.query.place_string)
  }
})

app.get('/top_subcategories', function (req, res) {
  if (req.query.user_token == null) {
    res.sendStatus("401");
    res.send("Unauthorized access for /top_subcategories endpoint!");

  } else {
    top_subcategories.get_categories(redis_client, req.query.user_token,
      function(err, results) {
        if (err) {
          console.log(err);
          res.send(err);
        } else {
          res.send(results);
        }
    });
  }
})

app.post('/update_subcat_score', function(req, res) {
  if (req.query.user_id == null) {
    res.sendStatus("401");
    res.send("Unauthorized access for /update_subcat_score endpoint!");

  } else {
    if (req.query.subtypes == null) {
      res.sendStatus("400");
      res.send("Bad request! Missing subtypes param.");

    } else {
      var counter = req.query.subtypes.length;

      req.query.subtypes.forEach( function (subtype) {
        console.log("Update subcategory:", subtype);

        redis_client.hget('user:' + req.query.user_id + ':subtypes', subtype,
          function(err, score) {
            if (err) {
              console.log(err);
            }

            if (score != null) {
              score = parseInt(score);
              score += 0.2 * score;

              redis_client.hset('user:' + req.query.user_id + ':subtypes', subtype, score);
            }

            if (--counter == 0) {
              console.log("All subcategories updated");
              res.end();
            }
        });
      });
    }
  }

  console.log('Got a GET request at /update_subcat_score with token: ' + req.query.user_token + ' and subtypes: ' + req.query.subtypes)
})

app.post('/login', function (req, res) {
  if (req.query.user_token == null) {
    res.sendStatus("401");
    res.send("Invalid login details!");
  } else {
    var user_login = {'user_token':req.query.user_token}
    fb.getUserProfile(user_login, function(err, user_info) {
      saveUserLogin(user_login, user_info, function(err, user_set) {
        if (user_set) {
          user_profile = {"user_info":user_info, "user_login":user_login}
          fb.getUserCheckins(user_profile, function(err, user_checkins) {
            google_places.getPlacesTags(user_checkins, function(err, places_tags) {
              saveUserTags(user_info.id, places_tags, function(err) {
                res.end()
              });
            });
          });
        } else {
            res.end()
        }
      });
    });
    console.log('Got a PUT request at /login with token: ' + req.query.user_token)
  }
})

app.put('/', function (req, res) {
  res.send('Got a PUT request')
  res.end()
})

app.delete('/user', function (req, res) {
  res.send('Got a DELETE request at /user')
  res.end()
})

app.listen(port, function() {
    //initRedisUsers()
    console.log(`Webserver app listening on port ${port}!`)
});
