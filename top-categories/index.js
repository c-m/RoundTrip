const CONSTANTS = require('../ml-subcategories-generator/constants.json')
const shuffle = require('shuffle-array')
const TOP_N = 9

module.exports = {
  get_categories
}

function get_categories(client, token, callback) {
  var result;

  client.hgetall('user:' + token + ':subtypes', (err, subtypes) => {
    if (err) {
      callback(err);
    }

    if (Object.keys(subtypes).length < TOP_N) {
      result = Object.keys(subtypes);
      candidates = CONSTANTS.subcategories;

      shuffle(candidates);

      candidates.forEach(elem => {
        if (!result.includes(elem) && result.length < TOP_N) {
          result.push(elem);
        }
      });

    } else { 
      result = sort(subtypes).slice(0,TOP_N)
    }

    callback(null, result);
  }); 
}

function sort(obj) {
  return Object.keys(obj).sort(function(a,b){return obj[b]-obj[a]})
}
