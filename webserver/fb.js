var FB = require('fb')
FB.options({version: 'v3.2'});

exports.getUserProfile = function(user_login, cb) {
  var user_token = user_login.user_token
  FB.setAccessToken(user_token)
  FB.api('/me', {fields: 'id,name,email'}, function(res) {
    if(!res || res.error) {
      console.log(!res ? 'error occurred' : res.error);
      cb(res.error)
      return;
    }
    user_info = {'name':res.name, 'id':res.id, 'email':res.email}
    cb(null, user_info)
  });
};

exports.getUserCheckins = function(user_profile, cb) {
  var user_token = user_profile.user_login.user_token
  FB.setAccessToken(user_token)
  var user_id = user_profile.user_info.id
  var checkins_endpoint = '/' + user_id + '/tagged_places'
  FB.api(checkins_endpoint, function(res) {
    if(!res || res.error) {
      console.log(!res ? 'error occurred' : res.error);
      cb(res.error)
      return;
    }
    user_checkins = []
    if (res.data.length != 0) {
      for(item in res.data) {
        checkin = {}
        checkin['name'] = res.data[item].place.name
        checkin['lat'] = res.data[item].place.location.latitude
        checkin['lng'] = res.data[item].place.location.longitude
        user_checkins.push(checkin)
      }
    }
    cb(null, user_checkins)
  });
};
