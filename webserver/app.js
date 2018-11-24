var express = require('express')
var redis = require('redis')
var app = express()
var fb = require("./fb.js")
var google_places = require("../gmaps/places.js")
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
  Object.keys(tag_types).foreach((type) => {
    redis_client.hset('user:' + user_id + ':types', type, tag_types[type])
  });
  Object.keys(tag_subtypes).foreach((subtype) => {
    redis_client.hset('user:' + user_id + ':subtypes', subtype, tag_subtypes[subtype])
  });
  cb();
}

app.use(function (req, res, next) {
  res.header("Content-Type",'application/json;charset=utf-8');
  next();
});

app.get('/status', function (req, res) {
  res.send({'status':'OK'})
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
            console.log(user_checkins)
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
