const ssim = require('string-similarity');
const util = require('util');
const gclient = require('@google/maps').createClient({
  key: 'AIzaSyBUzjhA-C9VNcwZ15rrVkc5M_Am2leLQP4'
});
const redis = require('redis');
const redis_client = redis.createClient();
const place_subtypes = require('../place-subtypes-generator');

const config = require('./config.json');
const constants = require('../ml-subcategories-generator/constants.json');

function getPlaceDetails(place, cb) {
	gclient.place({
		placeid: place.placeid
	}, function (err, ret) {
		if (err) {
			throw new Error("Err at gmaps/place; placeid:", place.placeid, err);
		}
    //console.log(ret.json.result);
		cb(null, ret.json.result);
	});
}

function getPlaceID(place, cb) {
	gclient.placesNearby({
		location: place,
		radius: config.placeDetails.radius
	}, function (err, ret) {
		if (err) {
			throw new Error("Err at gmaps/nearbysearch; place", place, err);
		}

		/* select the place with the given name */
		var rarray = ret.json.results;
		for (var i = 0; i < rarray.length; i++) {
			//console.log("Cmp", rarray[i].name, place.name, ":", ssim.compareTwoStrings(rarray[i].name, place.name));
			if (ssim.compareTwoStrings(rarray[i].name, place.name) > config.placeDetails.nameThreshold) {
				return cb(null, rarray[i].place_id);
			}
		}
		console.warn("Could not find place_id for place:", place);
		cb(null, "");
	});
}

function processPlace(place, cb) {
	var ret = {};
	getPlaceDetails(place, function (err, details) {
		ret.types = Array.from(details.types);
		place_subtypes.getSubtypes({ result: details }, function(err, stypes) {
			ret.subtypes = stypes;
			cb(null, ret);
		});
	});
}

/**
 * Gets place types and subtypes
 *
 * @param {Object} place
 * @param {string=} place.name
 * @param {string=} place.lat
 * @param {string=} place.lng
 * @param {string=} place.placeid
 * @return {object} tags
 * @return {string[]} tags.types
 * @return {string[]} tags.subtypes
 */
exports.getPlaceTags = function (place, cb) {
	if (place.placeid) {
		processPlace(place, function(err, res) {
			cb(null, res);
		});
	} else if (place.name && place.lat && place.lng) {
		getPlaceID(place, function (err, placeid) {
			place.placeid = placeid;
			processPlace(place, function(err, res) {
				cb(null, res);
			});
		});
	} else throw new Error("Err at gmaps/place: incomplete place object");
}

/**
 * Gets tags for array of places
 * 
 * @return {object} tags
 * @return {object[]} tags.types
 * @return {object[]} tags.subtypes
 */
exports.getPlacesTags = function (places, cb) {
	var ret = {
		types: {},
		subtypes: {}
	};
	var done = places.length;
	for (var i = 0; i < places.length; i++) {
		this.getPlaceTags(places[i], function (err, tags) {
			/* count types */
			for (var j = 0; j < tags.types.length; j++) {
				var type = tags.types[j];
				if (ret.types[type] !== undefined) ret.types[type]++;
				else ret.types[type] = 1;
			}
			/* count subtypes */
			for (var j = 0; j < tags.subtypes.length; j++) {
				var stype = tags.subtypes[j];
				if (ret.subtypes[stype] !== undefined) ret.subtypes[stype]++;
				else ret.subtypes[stype] = 1;
			}
			if (--done <= 0) {
				cb(null, ret);
			}
		});
	}
}

function findLocation(name, cb) {
	//return cb(null, locationMock);
	gclient.findPlace({
		input: name,
		inputtype: 'textquery',
		fields: [ 'name', 'geometry']
	}, function(err, ret) {
		if (err) {
			throw new Error("Err at gmaps/findplace; name:", name, err);
		}
		cb(null, ret.json.candidates[0].geometry.location);
	});
}

function filterResults(results) {
	var filtered = [];
	for (var i = 0; i < results.length; i++) {
		var algood = true;
		var result = results[i];
		console.log(" --- ", result.name, ' --- ', result.types);
		for (var j = 0; j < result.types.length; j++) {
			if (constants.categories.indexOf(result.types[j]) == -1) {
				allgood = false;
				break;
			}
		}
		if (allgood) {
			filtered.push(result);
		}
	}
	console.log("FILTERED:", filtered);
	return filtered;
}

function printRes(res) {
	console.log(res.length);
	for (var i = 0; i < res.length; i++) {
		console.log(" --- ", res[i].name, ' --- ', res[i].types);
	}
}

function loopNearby(result, location, pagetoken, category, cb) {
	/* ugly to pass validation */
	var obj = pagetoken ?
		{
			pagetoken: pagetoken
		} :
		{
			location: location,
			radius: config.nearby.radius,
			type: category
		};

	gclient.placesNearby(obj, function(err, ret) {
    if (err) {
      throw new Error("Err at loop gmaps/nearby", err);
    }
		result = result.concat(ret.json.results);
    return cb(null, result);
    /*
		if (result.length >= config.nearby.maxno || !(ret.json.next_page_token)) {
      console.log("Category", category, "finished");
			return cb(null, result);
		}
		loopNearby(result, location, ret.json.next_page_token, category, cb);
    */
	});	
}

function getNearbyPlaces(location, cb) {
	//return cb(null, smallTownMock);
	var result = [];
	var done = constants.categories.length;

	constants.categories.forEach(function(categ) {
		loopNearby([], location, null, categ, function(err, ret) {
			if (err) {
				throw new Error("Err at gmaps/nearby", err);
			}
			result = result.concat(ret);
			if (--done <= 0) {
				cb(null, result);
			}
		});
	});
}

function packPlaces(townName, raw_places, cb) {
  var done = 50; //raw_places.length;
  var tkey = townName + ":places";
  var result = {
    places: {}
  };
  result[tkey] = {};

  if (raw_places.length == 0) {
  	cb(null, result);
  	return;
  }

  var i = 0;
  var interval = setInterval(function() {
    var place = raw_places[i];
    i++;
    for (var j = 0; j < place.types.length; j++) {
      var type = place.types[j];
      if (result[tkey][type] === undefined)
        result[tkey][type] = [];
      result[tkey][type].push(place.place_id);
    }

    processPlace({ placeid: place.place_id }, function(err, ret) {
      result.places[place.place_id] = {
        raw_json: JSON.stringify(place),
        types: place.types,
        subtypes: ret.subtypes
      }

      console.log('Done', done);
      if (--done <= 0) {
        cb(null, result);
        clearInterval(interval);
      }
    });
  }, 500);
}

exports.getPlaces = function(townName, cb) {
	redis_client.keys(townName+':google_places', function (err, res) {
		if (res.length != 0) {
			console.log("Town", townName, "already in cache!");
			return cb(null, {});
		}
		findLocation(townName, function(err, location) {
			getNearbyPlaces(location, function(err, places) {
				packPlaces(townName, places, cb);
			});
		});
	});
}

var detailsMock = { html_attributions: [],
  result: 
   { address_components: [ [Object], [Object], [Object], [Object], [Object], [Object] ],
     adr_address: '<span class="street-address">Calea lui Traian 140</span>, <span class="locality">Râmnicu Vâlcea</span>, <span class="country-name">Romania</span>',
     formatted_address: 'Calea lui Traian 140, Râmnicu Vâlcea, Romania',
     formatted_phone_number: '0942 555 125',
     geometry: { location: [Object], viewport: [Object] },
     icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
     id: 'b8016b109d8f9626ab14516bc58a394caa162ff7',
     international_phone_number: '+40 942 555 125',
     name: 'Black Corner',
     opening_hours: { open_now: true, periods: [Array], weekday_text: [Array] },
     photos: 
      [ [Object],
        [Object],
        [Object],
        [Object],
        [Object],
        [Object],
        [Object],
        [Object],
        [Object],
        [Object] ],
     place_id: 'ChIJ87cnb7E4TUcR1BEdoFyjZwQ',
     plus_code: 
      { compound_code: '4957+JH Râmnicu Vâlcea, Romania',
        global_code: '8GQ64957+JH' },
     rating: 3.8,
     reference: 'ChIJ87cnb7E4TUcR1BEdoFyjZwQ',
     reviews: [ [Object], [Object], [Object], [Object], [Object] ],
     scope: 'GOOGLE',
     types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
     url: 'https://maps.google.com/?cid=317401916971487700',
     utc_offset: 120,
     vicinity: 'Calea lui Traian 140, Râmnicu Vâlcea' },
  status: 'OK'
}

var locationMock = { lat: 52.52000659999999, lng: 13.404954 };

var smallTownMock = [
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_recreational-71.png',
    id: 'b27f64997bef16b5fdc073f5bd288d77bc7331fb',
    name: 'Vacaresti Park Nature Reserve',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJl5BE92D-sUARPDc9IShsBOQ',
    plus_code: 
     { compound_code: '94XM+Q7 Bucharest, Romania',
       global_code: '8GP894XM+Q7' },
    rating: 4.3,
    reference: 'ChIJl5BE92D-sUARPDc9IShsBOQ',
    scope: 'GOOGLE',
    types: [ 'zoo', 'park', 'point_of_interest', 'establishment' ],
    vicinity: 'Bucharest' }
    ];

var townMock = 
 [ { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '14f922892148c8069d727f7d0741583bbf29400c',
    name: 'Bark Park',
    place_id: 'ChIJtQF0her-sUAR83182gDrV1g',
    plus_code: 
     { compound_code: 'C49W+84 Bucharest, Romania',
       global_code: '8GP8C49W+84' },
    reference: 'ChIJtQF0her-sUAR83182gDrV1g',
    scope: 'GOOGLE',
    types: [ 'zoo', 'point_of_interest', 'establishment' ],
    vicinity: 'Dristor, Bucharest' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_recreational-71.png',
    id: 'b27f64997bef16b5fdc073f5bd288d77bc7331fb',
    name: 'Vacaresti Park Nature Reserve',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJl5BE92D-sUARPDc9IShsBOQ',
    plus_code: 
     { compound_code: '94XM+Q7 Bucharest, Romania',
       global_code: '8GP894XM+Q7' },
    rating: 4.3,
    reference: 'ChIJl5BE92D-sUARPDc9IShsBOQ',
    scope: 'GOOGLE',
    types: [ 'zoo', 'park', 'point_of_interest', 'establishment' ],
    vicinity: 'Bucharest' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '4805dfa61a92d790f7e75dda3c8209785c3a6c8e',
    name: 'Tarc De Caini (Bark Park)',
    photos: [ [Object] ],
    place_id: 'ChIJVSRru7_-sUARHgPvuAyvIro',
    plus_code: 
     { compound_code: 'C592+JM Bucharest, Romania',
       global_code: '8GP8C592+JM' },
    reference: 'ChIJVSRru7_-sUARHgPvuAyvIro',
    scope: 'GOOGLE',
    types: [ 'zoo', 'point_of_interest', 'establishment' ],
    vicinity: 'Intrarea Odobești 12, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'b98de082a13338979a6b9b5cb124b0af7e0cbd97',
    name: 'Curtea Paunilor',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJwxfz88f-sUARFMBiAfwQctE',
    plus_code: 
     { compound_code: 'C5G3+4W Bucharest, Romania',
       global_code: '8GP8C5G3+4W' },
    rating: 3,
    reference: 'ChIJwxfz88f-sUARFMBiAfwQctE',
    scope: 'GOOGLE',
    types: [ 'zoo', 'point_of_interest', 'establishment' ],
    vicinity: 'Titan, Bucharest' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'e8878a2a6917759a60d93919c3e615dc1d1619a3',
    name: 'Terra Park',
    photos: [ [Object] ],
    place_id: 'ChIJkb8AGNEBskARvKMmPeyl6e8',
    plus_code: 
     { compound_code: 'C2JW+25 Bucharest, Romania',
       global_code: '8GP8C2JW+25' },
    rating: 3.7,
    reference: 'ChIJkb8AGNEBskARvKMmPeyl6e8',
    scope: 'GOOGLE',
    types: [ 'amusement_park', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Timișoara 8A, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '468f3077d68d45178c12886d46ff28b0b8349173',
    name: 'Ștrandul CARA Titan',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJNw2Y17z-sUARqRx19jFyQus',
    plus_code: 
     { compound_code: 'C587+P6 Bucharest, Romania',
       global_code: '8GP8C587+P6' },
    rating: 3.4,
    reference: 'ChIJNw2Y17z-sUARqRx19jFyQus',
    scope: 'GOOGLE',
    types: [ 'amusement_park', 'park', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Nicolae Grigorescu, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '781410a46362309df6e65dffd091892b5214bf9f',
    name: 'SWEET BABIES CLUB',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJwYAiRin_sUAR2jF7qj_aeG8',
    rating: 5,
    reference: 'ChIJwYAiRin_sUAR2jF7qj_aeG8',
    scope: 'GOOGLE',
    types: [ 'amusement_park', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Teleajen 26, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: 'd8cf489c2bf4e95e17a843a2c59f7c8daca8da7c',
    name: 'Sector 2 City Hall',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJKfy-Ys74sUARoQLjv53h7jY',
    plus_code: 
     { compound_code: 'C4XG+CX Bucharest, Romania',
       global_code: '8GP8C4XG+CX' },
    rating: 2.8,
    reference: 'ChIJKfy-Ys74sUARoQLjv53h7jY',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Chiristigiilor 11-13, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: 'ad3575bf90c36771459844d2230161c9e0df6bda',
    name: 'Primăria Sectorului 1',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJpUXXgPcBskAR6Oc1MGyPg98',
    plus_code: 
     { compound_code: 'F33F+GH Bucharest, Romania',
       global_code: '8GP8F33F+GH' },
    rating: 3.2,
    reference: 'ChIJpUXXgPcBskAR6Oc1MGyPg98',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bucharest' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '3ab8a3d413e172e314809ead7c317d0f06a7fa52',
    name: 'Primăria Sectorului 4',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJhVq6T3P_sUAR-balxRxltME',
    plus_code: 
     { compound_code: 'C3CQ+CM Bucharest, Romania',
       global_code: '8GP8C3CQ+CM' },
    rating: 2.1,
    reference: 'ChIJhVq6T3P_sUAR-balxRxltME',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bulevardul George Coșbuc 6-16, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '3730193f1f90f3548ec18511187ccdccbdfd938d',
    name: 'Hall Sector 6',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJbamahu8BskARVHzNk0kVoVI',
    plus_code: 
     { compound_code: 'C3W8+9H Bucharest, Romania',
       global_code: '8GP8C3W8+9H' },
    rating: 2.2,
    reference: 'ChIJbamahu8BskARVHzNk0kVoVI',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Calea Plevnei 147-149, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '0459c4dc15cf4e120d7ea4cd986587914ae8e840',
    name: 'Primăria Sector 2',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ3SknDTH_sUARdM5v9kHNJXw',
    plus_code: 
     { compound_code: 'C4XH+G2 Bucharest, Romania',
       global_code: '8GP8C4XH+G2' },
    rating: 3.6,
    reference: 'ChIJ3SknDTH_sUARdM5v9kHNJXw',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Ziduri Moși 23, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '923080ff5a827eb3f15154b800ea66e1a95d0048',
    name: 'Bucharest City Hall',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ2evv0UP_sUARs-p13kfFBBU',
    plus_code: 
     { compound_code: 'C3MV+Q7 Bucharest, Romania',
       global_code: '8GP8C3MV+Q7' },
    rating: 1.8,
    reference: 'ChIJ2evv0UP_sUARs-p13kfFBBU',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bulevardul Regina Elisabeta 47, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '0d506d67ecf1d983369bbd1315e311544be2da8b',
    name: 'Bucharest District 3 City Hall',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJNfAbGuj-sUARMFz6PZD_FJI',
    plus_code: 
     { compound_code: 'C4CP+5G Bucharest, Romania',
       global_code: '8GP8C4CP+5G' },
    rating: 2.1,
    reference: 'ChIJNfAbGuj-sUARMFz6PZD_FJI',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Calea Dudești 191, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '00131986c0fba79e635f2977a091e08cd84f2246',
    name: 'Sector 5 City Hall',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJczBpz0P_sUARvj8tmzH9eqw',
    plus_code: 
     { compound_code: 'C38R+42 Bucharest, Romania',
       global_code: '8GP8C38R+42' },
    rating: 2.3,
    reference: 'ChIJczBpz0P_sUARvj8tmzH9eqw',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Fabrica de Chibrituri 9-11, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: 'b0e113f818e770a52a8281bbfdf452876b87e488',
    name: 'Biroul Evidenţă Persoane nr. 1 (Secţia 6 Poliţie)',
    place_id: 'ChIJ3bKpaLL4sUARwkLITJwI3xw',
    plus_code: 
     { compound_code: 'F423+JR Bucharest, Romania',
       global_code: '8GP8F423+JR' },
    reference: 'ChIJ3bKpaLL4sUARwkLITJwI3xw',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Paul Greceanu 36, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/civic_building-71.png',
    id: '377a1b491d08e317da5bac537bc69052d27da62a',
    name: 'Primaria Sector 6',
    place_id: 'ChIJk9KFhu8BskARkeQjWnGJ240',
    reference: 'ChIJk9KFhu8BskARkeQjWnGJ240',
    scope: 'GOOGLE',
    types: 
     [ 'city_hall',
       'premise',
       'local_government_office',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bucharest' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '0ee2dbb0ba103da2d1c60cc19aa6d6ea54ccdfa8',
    name: 'Acvariul',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ9yadgv7-sUAR6Jwsj_wKduE',
    rating: 1,
    reference: 'ChIJ9yadgv7-sUAR6Jwsj_wKduE',
    scope: 'GOOGLE',
    types: [ 'aquarium', 'point_of_interest', 'establishment' ],
    vicinity: 'București,România, Calea Văcărești 203, Sector 4' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '79eea4589eeaff5d8d6d6762fe0ad4120ceea689',
    name: 'African cichlids Bucharest',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJc6O2pMj4sUARR0R06CAxT58',
    rating: 4.6,
    reference: 'ChIJc6O2pMj4sUARR0R06CAxT58',
    scope: 'GOOGLE',
    types: [ 'aquarium', 'point_of_interest', 'establishment' ],
    vicinity: 'Șoseaua Colentina 3B, bloc 33 B, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: 'eed4820b868f93d261ee6b42087e262ef4ff6209',
    name: 'RIN Grand Hotel',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJuzdLPIocskARPclMN86Nluo',
    plus_code: 
     { compound_code: '94XV+G7 Bucharest, Romania',
       global_code: '8GP894XV+G7' },
    rating: 4.2,
    reference: 'ChIJuzdLPIocskARPclMN86Nluo',
    scope: 'GOOGLE',
    types: 
     [ 'gym',
       'lodging',
       'health',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Șoseaua Vitan-Bârzești 7D, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '5b56e0870c9068ecb47a98b3d4d277ff49725896',
    name: 'Hotel Ambasador',
    photos: [ [Object] ],
    place_id: 'ChIJyxxm507_sUARWzWc4dDySNk',
    plus_code: 
     { compound_code: 'C3RX+QQ Bucharest, Romania',
       global_code: '8GP8C3RX+QQ' },
    rating: 4.1,
    reference: 'ChIJyxxm507_sUARWzWc4dDySNk',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Bulevardul General Gheorghe Magheru 7, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '536cb3008bf7dd8c1feab4ad77b7420559fc1e53',
    name: 'Radisson Blu Hotel, Bucharest',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJEXYoWEX_sUARwQnfVA7TqqQ',
    plus_code: 
     { compound_code: 'C3RV+HQ Bucharest, Romania',
       global_code: '8GP8C3RV+HQ' },
    rating: 4.5,
    reference: 'ChIJEXYoWEX_sUARwQnfVA7TqqQ',
    scope: 'GOOGLE',
    types: 
     [ 'spa',
       'bar',
       'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Calea Victoriei 63-81, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '9f4e3c58ab34f0c358c9547f8faaa40727f64666',
    name: 'Mercure Bucharest Unirii',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJUZ9ChxX_sUAR_mwheNeSFlc',
    plus_code: 
     { compound_code: 'C4G6+WP Bucharest, Romania',
       global_code: '8GP8C4G6+WP' },
    rating: 4,
    reference: 'ChIJUZ9ChxX_sUAR_mwheNeSFlc',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: '28th Mircea Voda Boulevard, BUCHAREST' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '50e95e1ca149976d5f9f46bdcd958cee736f9d2d',
    name: 'Hotel Yesterday',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJuwGwT-gBskARyRooMxI_EBg',
    plus_code: 
     { compound_code: 'C3R5+MJ Bucharest, Romania',
       global_code: '8GP8C3R5+MJ' },
    rating: 4,
    reference: 'ChIJuwGwT-gBskARyRooMxI_EBg',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Economu Cezărescu 8, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: 'ff2bd2107441db1cff4a6e0d307d460f02d3405b',
    name: 'Graffiti Hotel',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJW6Batq74sUARJJzJ2f6snNQ',
    plus_code: 
     { compound_code: 'F442+83 Bucharest, Romania',
       global_code: '8GP8F442+83' },
    rating: 4,
    reference: 'ChIJW6Batq74sUARJJzJ2f6snNQ',
    scope: 'GOOGLE',
    types: 
     [ 'bar',
       'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Albac 25, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: '0be26477a5ad7de1116ccfb3a84422c7e4b01075',
    name: 'HOTEL ZAVA',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJ8VFAqzr_sUAR3CA7pPFP3Ys',
    plus_code: 
     { compound_code: 'C4P9+36 Bucharest, Romania',
       global_code: '8GP8C4P9+36' },
    price_level: 2,
    rating: 3.8,
    reference: 'ChIJ8VFAqzr_sUAR3CA7pPFP3Ys',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Strada Ștefan Mihăileanu 21, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '66a052de34164431971c638f2dad901aa4fc0969',
    name: 'Hotel Novotel Bucharest City Centre',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJ4ewzl0b_sUAR0pV8a8Qn-xw',
    plus_code: 
     { compound_code: 'C3PW+PV Bucharest, Romania',
       global_code: '8GP8C3PW+PV' },
    rating: 4.5,
    reference: 'ChIJ4ewzl0b_sUAR0pV8a8Qn-xw',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Calea Victoriei 37B, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '4f69b5291e76342d0b21b40f1763ec97adeae37a',
    name: 'DBH Bucharest',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJh0SSyq_4sUARWmk8XNw2oZY',
    plus_code: 
     { compound_code: 'F444+84 Bucharest, Romania',
       global_code: '8GP8F444+84' },
    rating: 4.4,
    reference: 'ChIJh0SSyq_4sUARWmk8XNw2oZY',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Barbu Văcărescu 51, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '7176f2f1f9ff4e215d8fbe64172b10e4cc358eab',
    name: 'Hotel ibis Bucharest Palatul Parlamentului City Centre',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJy1yXyWr_sUARBzv_MDgo6Ws',
    plus_code: 
     { compound_code: 'C3HJ+WQ Bucharest, Romania',
       global_code: '8GP8C3HJ+WQ' },
    rating: 3.8,
    reference: 'ChIJy1yXyWr_sUARBzv_MDgo6Ws',
    scope: 'GOOGLE',
    types: 
     [ 'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Izvor 82-84, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: 'bd36887b1038cd974380679231b70195c8eb58a9',
    name: 'Grand Café Van Gogh',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJM5g_jj__sUARVh11WU_h-nQ',
    plus_code: 
     { compound_code: 'C4J2+W2 Bucharest, Romania',
       global_code: '8GP8C4J2+W2' },
    price_level: 2,
    rating: 4.3,
    reference: 'ChIJM5g_jj__sUARVh11WU_h-nQ',
    scope: 'GOOGLE',
    types: 
     [ 'cafe',
       'bar',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Smârdan 9, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: '1e8871b3c0fda9d46ee2cb7c619d837962ea871f',
    name: 'Restaurant Taj',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJS7dRc3r_sUARXTcDXalJKLw',
    price_level: 2,
    rating: 4.3,
    reference: 'ChIJS7dRc3r_sUARXTcDXalJKLw',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Calea 13 Septembrie 127-131, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: '3106f38c51af7d042a53fdbfd2ee5115c2a59dc0',
    name: 'La Mama',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJQeldn0__sUARiUDrNpK4isI',
    price_level: 2,
    rating: 3.9,
    reference: 'ChIJQeldn0__sUARiUDrNpK4isI',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Strada Episcopiei 9, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: 'ae4751c01584279862d97ccb29adc271560cc71a',
    name: 'La Mama',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ_ZJhBz__sUAR5_lJTfKBafs',
    plus_code: 
     { compound_code: 'C4J3+Q2 Bucharest, Romania',
       global_code: '8GP8C4J3+Q2' },
    price_level: 2,
    rating: 3.9,
    reference: 'ChIJ_ZJhBz__sUAR5_lJTfKBafs',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Strada Băcani 1, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: '961b533a67e06a2821d4ba554c41e271708ee83b',
    name: 'Primus',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJ3c_z5k__sUARO8loIyBwmG4',
    plus_code: 
     { compound_code: 'C3RV+VR Bucharest, Romania',
       global_code: '8GP8C3RV+VR' },
    price_level: 2,
    rating: 4.5,
    reference: 'ChIJ3c_z5k__sUARO8loIyBwmG4',
    scope: 'GOOGLE',
    types: 
     [ 'restaurant',
       'bar',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada George Enescu 3, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: 'd3237ad400b078009bdffe53276059f07550d396',
    name: 'Thalia Tineretului',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJZwyjgwT_sUAR0tMUYifcn4M',
    plus_code: 
     { compound_code: 'C484+GQ Bucharest, Romania',
       global_code: '8GP8C484+GQ' },
    price_level: 2,
    rating: 4.3,
    reference: 'ChIJZwyjgwT_sUAR0tMUYifcn4M',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Strada Cuza Vodă 147, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: 'ab56cea97aefbaf5e83e7865cce0b1bb49af653b',
    name: 'Casa Oamenilor de Știință',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ6wSo6U3_sUAR-Fe7t8vJ0lg',
    plus_code: 
     { compound_code: 'C3WX+8J Bucharest, Romania',
       global_code: '8GP8C3WX+8J' },
    price_level: 2,
    rating: 3.9,
    reference: 'ChIJ6wSo6U3_sUAR-Fe7t8vJ0lg',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Piața Lahovari 9, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/bar-71.png',
    id: '6c68583a7c79013088d8b33401c60d5a87b70598',
    name: 'Curtea Berarilor',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJt0sqxD__sUAR7gcIoiuNcvU',
    plus_code: 
     { compound_code: 'C4J2+69 Bucharest, Romania',
       global_code: '8GP8C4J2+69' },
    price_level: 2,
    rating: 4.2,
    reference: 'ChIJt0sqxD__sUAR7gcIoiuNcvU',
    scope: 'GOOGLE',
    types: 
     [ 'bar',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Șelari 9-11, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'f07a8309441629e421f7fe60e11ac7d21b4ebaf4',
    name: 'Pizza Colosseum',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJPcdm6Eb_sUARN2KZ1WiXrzY',
    plus_code: 
     { compound_code: 'C3PX+JH Bucharest, Romania',
       global_code: '8GP8C3PX+JH' },
    rating: 4,
    reference: 'ChIJPcdm6Eb_sUARN2KZ1WiXrzY',
    scope: 'GOOGLE',
    types: 
     [ 'meal_delivery',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Calea Victoriei, nr. 48-50 (Pasaj Victoria), București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/restaurant-71.png',
    id: 'f9690f3fff1d282e85934e4137f9ec3d71eeef80',
    name: 'Restaurant Vatra',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ3U07-0P_sUARKGMHk-Cc34Q',
    plus_code: 
     { compound_code: 'C3PV+5Q Bucharest, Romania',
       global_code: '8GP8C3PV+5Q' },
    price_level: 2,
    rating: 4.2,
    reference: 'ChIJ3U07-0P_sUARKGMHk-Cc34Q',
    scope: 'GOOGLE',
    types: [ 'restaurant', 'point_of_interest', 'food', 'establishment' ],
    vicinity: 'Strada Ion Brezoianu 19, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
    id: '536cb3008bf7dd8c1feab4ad77b7420559fc1e53',
    name: 'Radisson Blu Hotel, Bucharest',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJEXYoWEX_sUARwQnfVA7TqqQ',
    plus_code: 
     { compound_code: 'C3RV+HQ Bucharest, Romania',
       global_code: '8GP8C3RV+HQ' },
    rating: 4.5,
    reference: 'ChIJEXYoWEX_sUARwQnfVA7TqqQ',
    scope: 'GOOGLE',
    types: 
     [ 'spa',
       'bar',
       'lodging',
       'restaurant',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Calea Victoriei 63-81, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '6a9ba4f7f37a73ba3ec1123251604b31c45e6d40',
    name: 'Orhideea Spa',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJgRDq8OUBskARUVV-G3PGul8',
    plus_code: 
     { compound_code: 'C3V8+J3 Bucharest, Romania',
       global_code: '8GP8C3V8+J3' },
    rating: 4.6,
    reference: 'ChIJgRDq8OUBskARUVV-G3PGul8',
    scope: 'GOOGLE',
    types: [ 'spa', 'lodging', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea Plevnei 145 B, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'd758d203da9df56f1b25fdf779b7cf97449afabb',
    name: 'Massaggi Erotici Bucarest - Masaj erotic centru Bucuresti',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJd3-hxjf_sUARYqLvQC41X-s',
    plus_code: 
     { compound_code: 'C4R5+7F Bucharest, Romania',
       global_code: '8GP8C4R5+7F' },
    rating: 4.3,
    reference: 'ChIJd3-hxjf_sUARYqLvQC41X-s',
    scope: 'GOOGLE',
    types: [ 'spa', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Vasile Lascăr nr. 35, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'b3b47042460bc0e3f1cd8c53b1aa8aad7dd53d55',
    name: 'Fiziolife Medica',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ5215cdn-sUAR5gPgiWFM1sQ',
    plus_code: 
     { compound_code: 'C4HM+CF Bucharest, Romania',
       global_code: '8GP8C4HM+CF' },
    rating: 3.7,
    reference: 'ChIJ5215cdn-sUAR5gPgiWFM1sQ',
    scope: 'GOOGLE',
    types: [ 'spa', 'gym', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Bloc S7, Scara1, Apartament 6, Etaj 2, Bulevardul Decebal 12, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '9e0b5a79c792a1e9337dddd5afa25861a6282108',
    name: 'Noblesse Unic',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ5URKt7T4sUARSgDCaE3DfIU',
    plus_code: 
     { compound_code: 'C4X5+5G Bucharest, Romania',
       global_code: '8GP8C4X5+5G' },
    rating: 4.6,
    reference: 'ChIJ5URKt7T4sUARSgDCaE3DfIU',
    scope: 'GOOGLE',
    types: [ 'spa', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Leonida 8, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '69f838eb7c4d3339bdb63f1aa6f94a8475814799',
    name: 'Viva Sport Club',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJC8B3PWj-sUARfvuVrIyO1k8',
    plus_code: 
     { compound_code: '94VF+4W Bucharest, Romania',
       global_code: '8GP894VF+4W' },
    rating: 4.6,
    reference: 'ChIJC8B3PWj-sUARfvuVrIyO1k8',
    scope: 'GOOGLE',
    types: 
     [ 'gym',
       'spa',
       'store',
       'health',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Șoseaua Olteniței, Sector 4 103, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'ee98ee67e50cdeef36986a0999eabf115e63923b',
    name: 'Stay Fit Gym - Titulescu',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJfWh0mPABskAR025NMaijZmg',
    plus_code: 
     { compound_code: 'F32C+78 Bucharest, Romania',
       global_code: '8GP8F32C+78' },
    rating: 4.3,
    reference: 'ChIJfWh0mPABskAR025NMaijZmg',
    scope: 'GOOGLE',
    types: [ 'gym', 'spa', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Șoseaua Nicolae Titulescu 171, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '84c938cac1d2ed06ea8882ceba3ff76db37eb8df',
    name: 'Alexandreea Club Fitness & Spa',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJEz1m483-sUARPbEQajQSpYs',
    plus_code: 
     { compound_code: 'C4MX+8P Bucharest, Romania',
       global_code: '8GP8C4MX+8P' },
    rating: 4.5,
    reference: 'ChIJEz1m483-sUARPbEQajQSpYs',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'spa',
       'gym',
       'health',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bulevardul Basarabia 37-39, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '4f75860415eecfa50b5c4aab7397a15821900f62',
    name: 'Eden Spa Bucuresti',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJGaQbxQ4CskARrGzw5F8gUgY',
    plus_code: 
     { compound_code: 'F38R+2J Bucharest, Romania',
       global_code: '8GP8F38R+2J' },
    rating: 4.6,
    reference: 'ChIJGaQbxQ4CskARrGzw5F8gUgY',
    scope: 'GOOGLE',
    types: [ 'spa', 'gym', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Pictor Ion Negulici nr. 4, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '3a151529774b67406655be9f49c3bb035296b0b9',
    name: 'Hobbit Concept EN',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJG4OnQdUBskAR_lmxsokLTXE',
    rating: 4.6,
    reference: 'ChIJG4OnQdUBskAR_lmxsokLTXE',
    scope: 'GOOGLE',
    types: [ 'spa', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada General George V. Macarovici, Macarovici St 23, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'e14886b5b89d4f739bdd8ba930aff036a7927b34',
    name: 'Olimpic Gym',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJhwAS_Z3_sUAR-Ys0QnC7N_Y',
    plus_code: 
     { compound_code: 'C38G+76 Bucharest, Romania',
       global_code: '8GP8C38G+76' },
    rating: 4.1,
    reference: 'ChIJhwAS_Z3_sUAR-Ys0QnC7N_Y',
    scope: 'GOOGLE',
    types: [ 'gym', 'spa', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea Rahovei, 266-268, corp 61, etaj 1, sector 5, incinta Electromagentica, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '8c40173ca11bc697ca9ee34a8951a7f1c35ad145',
    name: 'Ideal Contour',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJo-FZGAP_sUARnIKer9UGwts',
    plus_code: 
     { compound_code: 'C486+F6 Bucharest, Romania',
       global_code: '8GP8C486+F6' },
    rating: 4.8,
    reference: 'ChIJo-FZGAP_sUARnIKer9UGwts',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'hair_care',
       'spa',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bulevardul Gheorghe Șincai 13, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'd637e06fdf14e9486aaeb9f602fa6b3a25807211',
    name: 'Evidence Beauty Salon',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJlzhDMRT_sUARXB7S6QD2GXo',
    plus_code: 
     { compound_code: 'C4H3+CP Bucharest, Romania',
       global_code: '8GP8C4H3+CP' },
    rating: 4.5,
    reference: 'ChIJlzhDMRT_sUARXB7S6QD2GXo',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'hair_care',
       'spa',
       'health',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Bulevardul Unirii 1, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'a3ae2782e39f095cbc91b19ab1f5420f6e3f9403',
    name: 'Chocolat Salon',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJLVKYa634sUARtqkX9SZXPLQ',
    plus_code: 
     { compound_code: 'F422+98 Bucharest, Romania',
       global_code: '8GP8F422+98' },
    rating: 4.5,
    reference: 'ChIJLVKYa634sUARtqkX9SZXPLQ',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'hair_care',
       'spa',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Ion Bogdan 19, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '20166117ad78eeac7fd829c8ee33f02a8fb86638',
    name: 'Fiziolife Estetique',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJvxrcO9j-sUARa8Jp8g9LeFA',
    plus_code: 
     { compound_code: 'C4HP+CJ Bucharest, Romania',
       global_code: '8GP8C4HP+CJ' },
    rating: 5,
    reference: 'ChIJvxrcO9j-sUARa8Jp8g9LeFA',
    scope: 'GOOGLE',
    types: [ 'spa', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Str. Voronet, nr. 7, bl. D5, sc. 1, ap.1, parter, Sector 3, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'f67c295ab3d18d404cb8df6b16ee15f2d2e769e8',
    name: 'Maison Esthetique',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJVVQAT9_-sUARQ--1p-8uTuY',
    plus_code: 
     { compound_code: 'C4HH+32 Bucharest, Romania',
       global_code: '8GP8C4HH+32' },
    rating: 4.4,
    reference: 'ChIJVVQAT9_-sUARQ--1p-8uTuY',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'hair_care',
       'spa',
       'store',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Strada Cezar Bolliac 52, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '2f2c223300fa7d868944bc1684f5ca8d31eecad3',
    name: 'Anouk Beauty',
    place_id: 'ChIJ19w_tkj_sUARRmrycORbO0U',
    plus_code: 
     { compound_code: 'C4R2+77 Bucharest, Romania',
       global_code: '8GP8C4R2+77' },
    reference: 'ChIJ19w_tkj_sUARRmrycORbO0U',
    scope: 'GOOGLE',
    types: 
     [ 'beauty_salon',
       'spa',
       'health',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Apartament 1, Strada Vasile Conta 19, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '35009a00752f08e6dd06ca79850b12420dbf4618',
    name: 'Mirage Fashion SRL D',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJB-ols0z_sUARu6IDM8O3uK8',
    plus_code: 
     { compound_code: 'C4X4+6C Bucharest, Romania',
       global_code: '8GP8C4X4+6C' },
    reference: 'ChIJB-ols0z_sUARu6IDM8O3uK8',
    scope: 'GOOGLE',
    types: [ 'beauty_salon', 'spa', 'point_of_interest', 'establishment' ],
    vicinity: 'Nr.73, Strada Mihai Eminescu, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '3702275ed8cdf80917aab86aeb71baa4b4554ad3',
    name: 'I AM Body & Mind',
    opening_hours: { open_now: false },
    place_id: 'ChIJDS_5NPwBskARnnVBVC_kaIs',
    plus_code: 
     { compound_code: 'C3XJ+C4 Bucharest, Romania',
       global_code: '8GP8C3XJ+C4' },
    reference: 'ChIJDS_5NPwBskARnnVBVC_kaIs',
    scope: 'GOOGLE',
    types: [ 'spa', 'gym', 'health', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Leonida Varnali 13, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '95b32a5f1e1dd111ed2d369fd692ab75a6f4804e',
    name: 'Mon Beauty Salon',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJYxmj2Eb_sUARJS4NU3SQsuo',
    plus_code: 
     { compound_code: 'C3VX+MW Bucharest, Romania',
       global_code: '8GP8C3VX+MW' },
    rating: 4.8,
    reference: 'ChIJYxmj2Eb_sUARJS4NU3SQsuo',
    scope: 'GOOGLE',
    types: [ 'beauty_salon', 'spa', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Jules Michelet 15-17, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '7449a727aebce7c95f92ec1f0fc46d4595e52189',
    name: 'Cocor',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJLZ9raz7_sUARh9ymZdaBp3A',
    plus_code: 
     { compound_code: 'C4J3+4M Bucharest, Romania',
       global_code: '8GP8C4J3+4M' },
    rating: 3.3,
    reference: 'ChIJLZ9raz7_sUARh9ymZdaBp3A',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Ion C. Brătianu 29-33, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '784b62c9f03583cfc017e30fcb7755141e4e13fc',
    name: 'AFI Cotroceni',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJ8_9CI9ABskARBjvQLt48i-A',
    plus_code: 
     { compound_code: 'C3J2+7Q Bucharest, Romania',
       global_code: '8GP8C3J2+7Q' },
    rating: 4.5,
    reference: 'ChIJ8_9CI9ABskARBjvQLt48i-A',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul General Vasile Milea 4, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '19f669d38966f7a8d0c9bea5af1f6d3b827f714c',
    name: 'Bucharest Mall',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJhaLqMeH-sUARU50LfAR-2x0',
    plus_code: 
     { compound_code: 'C4CG+4P Bucharest, Romania',
       global_code: '8GP8C4CG+4P' },
    rating: 4.3,
    reference: 'ChIJhaLqMeH-sUARU50LfAR-2x0',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea Vitan 55-59, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'd96c0a06396d4a9ccd1cf9b4b98bf665865f8ab0',
    name: 'Sun Plaza',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJncwmH13-sUARk_NtZQiy37Q',
    plus_code: 
     { compound_code: '94WF+33 Bucharest, Romania',
       global_code: '8GP894WF+33' },
    rating: 4.3,
    reference: 'ChIJncwmH13-sUARk_NtZQiy37Q',
    scope: 'GOOGLE',
    types: 
     [ 'shopping_mall',
       'supermarket',
       'grocery_or_supermarket',
       'store',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Calea Văcărești nr. 391, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'bc8fcfcb0b4696b9bae601ea864d3b02e9e99180',
    name: 'Galeriile Titan',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJ47wn-7n-sUARXTqtgPyRCEk',
    plus_code: 
     { compound_code: 'C5F6+PG Bucharest, Romania',
       global_code: '8GP8C5F6+PG' },
    rating: 4,
    reference: 'ChIJ47wn-7n-sUARXTqtgPyRCEk',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Liviu Rebreanu 6A, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '78a0eaa63f9a755df8a9ef36d5be84481319e8fc',
    name: 'Magazinul Victoria',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJtSxAV0D_sUARjhkom-DGM-w',
    plus_code: 
     { compound_code: 'C3MW+5W Bucharest, Romania',
       global_code: '8GP8C3MW+5W' },
    rating: 3.9,
    reference: 'ChIJtSxAV0D_sUARjhkom-DGM-w',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Lipscani 17, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '1fdab56e3864697e3475df0e228f9ef860934ace',
    name: 'Prosper Plaza',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJB3mtyHj_sUARckbkyUyp9Ds',
    plus_code: 
     { compound_code: 'C3C8+27 Bucharest, Romania',
       global_code: '8GP8C3C8+27' },
    rating: 3.8,
    reference: 'ChIJB3mtyHj_sUARckbkyUyp9Ds',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea 13 Septembrie 221- 225, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'b473faf36aafb66270bb29505b538112e6d11adb',
    name: 'Metropolis Center',
    photos: [ [Object] ],
    place_id: 'ChIJHyc-j6z4sUARmJmFjAMASJQ',
    plus_code: 
     { compound_code: 'F32X+R2 Bucharest, Romania',
       global_code: '8GP8F32X+R2' },
    rating: 4.2,
    reference: 'ChIJHyc-j6z4sUARmJmFjAMASJQ',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Grigore Alexandrescu 89-97, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'e4cfd0bf3263cf01066c830a75f0cf01c25a3176',
    name: 'Bentel Sistem S.R.L.',
    photos: [ [Object] ],
    place_id: 'ChIJo0p_oTP_sUARU7g820a5HUg',
    plus_code: 
     { compound_code: 'C4R9+WR Bucharest, Romania',
       global_code: '8GP8C4R9+WR' },
    rating: 4.7,
    reference: 'ChIJo0p_oTP_sUARU7g820a5HUg',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Traian 18, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '89edb7f87356e41fcd4fdc54003595a219186b55',
    name: 'Sisteme Incalzire',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ_7_2qDP_sUARYj0UNMgDO04',
    plus_code: 
     { compound_code: 'C4RC+Q3 Bucharest, Romania',
       global_code: '8GP8C4RC+Q3' },
    rating: 2,
    reference: 'ChIJ_7_2qDP_sUARYj0UNMgDO04',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Intrare stanga, Et. 1, Ap. 3, Sector 2, Strada Dimitrie Onciul 33A, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '63c0102cd7962578650747e44479b505688b2056',
    name: 'Winmarkt',
    photos: [ [Object] ],
    place_id: 'ChIJ8wrHTtf-sUARpPISgADov3Y',
    plus_code: 
     { compound_code: 'C4JP+HW Bucharest, Romania',
       global_code: '8GP8C4JP+HW' },
    rating: 3.4,
    reference: 'ChIJ8wrHTtf-sUARpPISgADov3Y',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Olympia Tower, Etajul 10, Bulevardul Decebal 25-29, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'b0c564ab6eda1f6867add65666a00c2104b42cfd',
    name: 'Kodak Photoshop',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJE6JFykr-sUARvElLWtVwyNw',
    plus_code: 
     { compound_code: '93VV+C8 Bucharest, Romania',
       global_code: '8GP893VV+C8' },
    rating: 4.1,
    reference: 'ChIJE6JFykr-sUARvElLWtVwyNw',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Șoseaua Giurgiului 86, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '617bcddd2789ac9fa70d0a29742a5a34931b5578',
    name: 'CONMAR PROJECT SRL',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ0b3csoL_sUARWodJp0eMR9Y',
    plus_code: 
     { compound_code: 'C389+RM Bucharest, Romania',
       global_code: '8GP8C389+RM' },
    reference: 'ChIJ0b3csoL_sUARWodJp0eMR9Y',
    scope: 'GOOGLE',
    types: 
     [ 'shopping_mall',
       'clothing_store',
       'store',
       'point_of_interest',
       'establishment' ],
    vicinity: 'Str. Sebastian Mihail, 62-88, Bucuresti-Sector 5, Bucuresti, 50784, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'cd6e1b28badf28399df382fa9f9371eb3e3eabdf',
    name: 'Madnik Auto Srl',
    opening_hours: { open_now: false },
    place_id: 'ChIJn_97Fz__sUAR7Is_2geRqEA',
    rating: 5,
    reference: 'ChIJn_97Fz__sUAR7Is_2geRqEA',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'I.C.Bratianu 16-18 ap.8, Sectorul 3, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '18bfb45ba2edcde48f0db624c00702f2286d5c4e',
    name: 'Mirano International S.R.L.',
    opening_hours: { open_now: true },
    photos: [ [Object] ],
    place_id: 'ChIJJ7SCRnz_sUARkHz2Docc-PE',
    plus_code: 
     { compound_code: 'C3CC+H6 Bucharest, Romania',
       global_code: '8GP8C3CC+H6' },
    rating: 4.1,
    reference: 'ChIJJ7SCRnz_sUARkHz2Docc-PE',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Str. Progresului, 90-100, Bucuresti-Sector 5, Bucuresti, 050693, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '9b340110399ef21def6564e1e446af768e30eaa7',
    name: 'Compania Naţională a Uraniului S.A.',
    place_id: 'ChIJUaS0vk7_sUARlsjiGxOWKrE',
    plus_code: 
     { compound_code: 'C4V2+GG Bucharest, Romania',
       global_code: '8GP8C4V2+GG' },
    rating: 3.9,
    reference: 'ChIJUaS0vk7_sUARlsjiGxOWKrE',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Str. Lupu Dionisie, 68, Bucuresti-Sector 2, Bucuresti, 10458, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '6470f112f3904993ca27205c13c3eded498e9b06',
    name: 'Crevedia Express',
    place_id: 'ChIJ_a8LJBD_sUAREjeew8NbN9I',
    plus_code: 
     { compound_code: 'C4C2+3C Bucharest, Romania',
       global_code: '8GP8C4C2+3C' },
    rating: 5,
    reference: 'ChIJ_a8LJBD_sUAREjeew8NbN9I',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'B-dul Marasesti, nr.42, bloc 1, scara 4, Sector 4, Bucuresti, Bulevardul Mărășești, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '61ece8768cf54e06bbf1db1f572127d5997f7407',
    name: 'Tehnoclima S.R.L.',
    place_id: 'ChIJRYpVJsr4sUAR7LnfvfqBT6A',
    plus_code: 
     { compound_code: 'C4X9+VQ Bucharest, Romania',
       global_code: '8GP8C4X9+VQ' },
    rating: 5,
    reference: 'ChIJRYpVJsr4sUAR7LnfvfqBT6A',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Int. Precupetii Vechi, 6, Bucuresti-Sector 2, Bucuresti, 20688, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '7bfc3985b7dde7d72728255db666f31a51667ee1',
    name: 'Crevedia Express',
    place_id: 'ChIJ4dRAqCX_sUAREudWWBSP5OM',
    plus_code: 
     { compound_code: 'C4M9+5X Bucharest, Romania',
       global_code: '8GP8C4M9+5X' },
    rating: 3,
    reference: 'ChIJ4dRAqCX_sUAREudWWBSP5OM',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'point_of_interest', 'establishment' ],
    vicinity: 'Piața Agroalimentară Traian, Corp A, Calea Călărași 116-122, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: '95e47d4058bc0f6fda3473e544b190919e92f078',
    name: 'Star Office',
    opening_hours: { open_now: false },
    place_id: 'ChIJX7wI19D-sUARrgPmIj7VGpc',
    plus_code: 
     { compound_code: 'C4JQ+XR Bucharest, Romania',
       global_code: '8GP8C4JQ+XR' },
    rating: 5,
    reference: 'ChIJX7wI19D-sUARrgPmIj7VGpc',
    scope: 'GOOGLE',
    types: [ 'shopping_mall', 'store', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Basarabia 7, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'e847188872beb10c88efb6482428a74ec4573f1c',
    name: 'Paintings Mario',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJlQ3HrYX_sUARHMaT7oE_gTE',
    plus_code: 
     { compound_code: 'C365+XX Bucharest, Romania',
       global_code: '8GP8C365+XX' },
    rating: 4.7,
    reference: 'ChIJlQ3HrYX_sUARHMaT7oE_gTE',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Iliada 9, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '2c3f6ba082f853585db62121c3b973878e9a83e5',
    name: 'Elite Art Gallery',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJcbW330b_sUARPe2KR_TTiOE',
    plus_code: 
     { compound_code: 'C3HW+HC Bucharest, Romania',
       global_code: '8GP8C3HW+HC' },
    rating: 4.3,
    reference: 'ChIJcbW330b_sUARPe2KR_TTiOE',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'nr. B. B2, parter,, Piața Națiunile Unite 3-5, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '66add7edb953529d196b8982758ca4c912703265',
    name: 'Carol 53',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ7ZnwTDf_sUARvltteVWvKTQ',
    plus_code: 
     { compound_code: 'C4Q7+22 Bucharest, Romania',
       global_code: '8GP8C4Q7+22' },
    rating: 4.6,
    reference: 'ChIJ7ZnwTDf_sUARvltteVWvKTQ',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Carol I 53, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '93f0eedad6d4ffacdcfa3ef089268f4aca6aaeae',
    name: 'Art galleries Horizon',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ_zA-G0b_sUAR4PCRFODP8h0',
    plus_code: 
     { compound_code: 'C3QX+JW Bucharest, Romania',
       global_code: '8GP8C3QX+JW' },
    rating: 4,
    reference: 'ChIJ_zA-G0b_sUAR4PCRFODP8h0',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Nicolae Bălcescu 23A, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'f86224fd2fd818e5bd8b975f8b903fd13c1a9c6e',
    name: 'Beba Art Gift Shop',
    photos: [ [Object] ],
    place_id: 'ChIJwbM4pk__sUARI6QqCfZAfiM',
    plus_code: 
     { compound_code: 'C3RX+V2 Bucharest, Romania',
       global_code: '8GP8C3RX+V2' },
    rating: 5,
    reference: 'ChIJwbM4pk__sUARI6QqCfZAfiM',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'store', 'point_of_interest', 'establishment' ],
    vicinity: '20 Nicolae Golescu Street, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'fae68818500b29b6a4a416cda14e70ac89fc1b2c',
    name: 'Galateca Gallery',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJEQfCjEX_sUARK8O5invNJ7M',
    plus_code: 
     { compound_code: 'C3RW+2X Bucharest, Romania',
       global_code: '8GP8C3RW+2X' },
    rating: 4.5,
    reference: 'ChIJEQfCjEX_sUARK8O5invNJ7M',
    scope: 'GOOGLE',
    types: 
     [ 'art_gallery',
       'book_store',
       'clothing_store',
       'store',
       'point_of_interest',
       'establishment' ],
    vicinity: '2-4 C.A. Rosetti Str., District 1, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '99e6225e5491853925d3a55aab27e7a703578943',
    name: 'Colorhood',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJXc5uKj__sUARLGsE9-m5HxU',
    plus_code: 
     { compound_code: 'C4M3+CV Bucharest, Romania',
       global_code: '8GP8C4M3+CV' },
    rating: 5,
    reference: 'ChIJXc5uKj__sUARLGsE9-m5HxU',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Nicolae Mavrogheni 10, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '506dcbfd85ba7fcb556992aa0f872a519a806dfd',
    name: 'Galeria Posibilă',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ3Qn-KjT_sUARFWUmWoM0Uy4',
    plus_code: 
     { compound_code: 'C4R7+M7 Bucharest, Romania',
       global_code: '8GP8C4R7+M7' },
    rating: 4.9,
    reference: 'ChIJ3Qn-KjT_sUARFWUmWoM0Uy4',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Popa Petre 6, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'fa88ac9222ab5a63225b8d879810ef83c6b9bece',
    name: 'Zorzini Gallery',
    opening_hours: { open_now: false },
    place_id: 'ChIJlzmjKDb_sUARbD6Wq_HHEnw',
    plus_code: 
     { compound_code: 'C3HV+GV Bucharest, Romania',
       global_code: '8GP8C3HV+GV' },
    rating: 4,
    reference: 'ChIJlzmjKDb_sUARbD6Wq_HHEnw',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea Giulești 14, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '9a7f79b22a6b50bff4a413e49027c988b8c0d412',
    name: 'AiurART',
    photos: [ [Object] ],
    place_id: 'ChIJYdPyoC3_sUARed0dLoubFtw',
    plus_code: 
     { compound_code: 'C4RG+89 Bucharest, Romania',
       global_code: '8GP8C4RG+89' },
    rating: 4.7,
    reference: 'ChIJYdPyoC3_sUARed0dLoubFtw',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Lirei 21, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'ad0324e5083f4d514ca7680afed83b8e76fb1aa3',
    name: 'Atelier de sticla Bucuresti, Art Glass Tischer.',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJlWE_STf-sUAR3bfkkvK8Ysg',
    rating: 5,
    reference: 'ChIJlWE_STf-sUAR3bfkkvK8Ysg',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Principatele Unite 7, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'dd1209ae3c1e1682b8991becb2c8c6a20a934d76',
    name: 'VATRA collective',
    photos: [ [Object] ],
    place_id: 'ChIJ5bONQ0j_sUARhskqppQGWhs',
    plus_code: 
     { compound_code: 'C4R3+2V Bucharest, Romania',
       global_code: '8GP8C4R3+2V' },
    reference: 'ChIJ5bONQ0j_sUARhskqppQGWhs',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Jean Louis Calderon, Nr 44, Bucuresti, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '7b73efaf5e123d055029d80544b2732930c58ef5',
    name: '438 Hall',
    photos: [ [Object] ],
    place_id: 'ChIJj0Y2oVP_sUAR6JNfspVhxKw',
    plus_code: 
     { compound_code: 'C3XV+8R Bucharest, Romania',
       global_code: '8GP8C3XV+8R' },
    rating: 4,
    reference: 'ChIJj0Y2oVP_sUAR6JNfspVhxKw',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Bulevardul Lascăr Catargiu 16, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '686c3f7c83f90904beef9d9aa28399f7b2752447',
    name: 'Anca Poterasu Gallery',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJt910KjD_sUARcl9lOPiCDR0',
    plus_code: 
     { compound_code: 'C4QC+27 Bucharest, Romania',
       global_code: '8GP8C4QC+27' },
    rating: 4.9,
    reference: 'ChIJt910KjD_sUARcl9lOPiCDR0',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Plantelor 58, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '99a1dab8101432d9ab37b1a8e16da5b08a5ec9e1',
    name: 'Gheorghe Grigore Gabriel S.N.C.',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJma8b1eIBskARZgM2czpIVZ8',
    rating: 4.4,
    reference: 'ChIJma8b1eIBskARZgM2czpIVZ8',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: '6-8, Strada Gării de Nord, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '149e799736bb62dc905e5332f63ee7a96e61e39c',
    name: 'LABORNA',
    photos: [ [Object] ],
    place_id: 'ChIJBYHBzEv_sUARG9vusb0UnZs',
    plus_code: 
     { compound_code: 'C4V4+FQ Bucharest, Romania',
       global_code: '8GP8C4V4+FQ' },
    rating: 5,
    reference: 'ChIJBYHBzEv_sUARG9vusb0UnZs',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Icoanei 17, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/shopping-71.png',
    id: 'a4d0f213b53ad6ab4fe1990460ac9f0939f6c76f',
    name: 'Libraria Bizantina',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJn_Cs2Bb_sUARK2P4lg7irgk',
    plus_code: 
     { compound_code: 'C4G2+4R Bucharest, Romania',
       global_code: '8GP8C4G2+4R' },
    rating: 4.7,
    reference: 'ChIJn_Cs2Bb_sUARK2P4lg7irgk',
    scope: 'GOOGLE',
    types: 
     [ 'book_store',
       'art_gallery',
       'cafe',
       'store',
       'point_of_interest',
       'food',
       'establishment' ],
    vicinity: 'Strada Bibescu Vodă 20, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '7b4fbb76c6d22aad16da8b396a9a3301b7df650a',
    name: 'MORA Art Center',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJt2qoRkH_sUAREHMqjw4SyAo',
    plus_code: 
     { compound_code: 'C3MW+XC Bucharest, Romania',
       global_code: '8GP8C3MW+XC' },
    rating: 3.9,
    reference: 'ChIJt2qoRkH_sUAREHMqjw4SyAo',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Parter, Bulevardul Regina Elisabeta 30, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: 'dddcd401b5bb3db912c3907b371e381091eee8b9',
    name: 'Galeria Calea Victoriei 33',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJ_Rimx0b_sUARmBCfr7sNz10',
    plus_code: 
     { compound_code: 'C3PX+93 Bucharest, Romania',
       global_code: '8GP8C3PX+93' },
    rating: 4.5,
    reference: 'ChIJ_Rimx0b_sUARmBCfr7sNz10',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Calea Victoriei 33, București, București' },
  { geometry: { location: [Object], viewport: [Object] },
    icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/generic_business-71.png',
    id: '4ef8b391a94a72c76f832eb0a6e6c4b994936150',
    name: 'CAV - Centrul Artelor Vizuale Multimedia',
    opening_hours: { open_now: false },
    photos: [ [Object] ],
    place_id: 'ChIJXyLDAkf_sUARm_t-YzoB0d4',
    plus_code: 
     { compound_code: 'C3PX+QV Bucharest, Romania',
       global_code: '8GP8C3PX+QV' },
    rating: 5,
    reference: 'ChIJXyLDAkf_sUARm_t-YzoB0d4',
    scope: 'GOOGLE',
    types: [ 'art_gallery', 'point_of_interest', 'establishment' ],
    vicinity: 'Strada Biserica Enei 16, București' }
    ];