
const CONSTANTS = require('./constants.json');
const language = require('@google-cloud/language');
const client = new language.LanguageServiceClient({
  projectId: 'roundtrip-1543001890834',
  keyFilename: 'C:\\Users\\Alex\\Desktop\\2NHack\\nlp.json'
});


module.exports = {
  get_subcategories,
}


function get_subcategories(text, callback) {
  console.log("Predicting categories...");
  
  const document = {
    content: text,
    type: 'PLAIN_TEXT',
  };
    
  client
  .classifyText({document: document})
  .then(results => {
    var classification = results[0];
    
    process_categories(classification.categories, callback);
  })
  .catch(err => {
    callback(err);
  });
}

function process_categories(categories, callback) {
  var map = new Map();
  var subcat;
  var counter = categories.length;

  categories.forEach(raw_subcat => {
    subcat = CONSTANTS.raw_subcategories[raw_subcat.name];

    if (subcat != undefined) {

      subcat.forEach(elem => {
        if (map.has(elem)) {
          map.set(elem, Math.max(raw_subcat.confidence, map.get(elem)));

        } else {
          map.set(elem, raw_subcat.confidence);
        }
      });
    }

    if (--counter == 0) {
      result = Array.from(map, el => {
        return {name: el[0], confidence: el[1]}
      });

    callback(null, result);       
    }
  });
}
