var express = require('express')
var redis = require('redis')
var app = express()
const port = 8000

client = redis.createClient();
client.on('error', function (err) {
  console.log('Error ' + err)
})

function saveUserLogin(user) {
  client.set("name", user.user_token)
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
    saveUserLogin(user_login)
    res.end()
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

app.listen(port, () => console.log(`Webserver app listening on port ${port}!`))
