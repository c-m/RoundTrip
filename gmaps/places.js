const ssim = require('string-similarity');
const util = require('util');
const gclient = require('@google/maps').createClient({
  key: 'AIzaSyBUzjhA-C9VNcwZ15rrVkc5M_Am2leLQP4'
});
const redis = require('redis');
//const rediscli = redis.createClient(6379, "192.168.0.253");
//const placeSubtypes = require('../place-subtypes-generator');

const config = require('./config.json');
const constants = require('../ml-subcategories-generator/constants.json');

function getPlaceDetails(place, cb) {
	// todo !!!!!!!! let the call
	return cb(null, detailsMock.result);
	gclient.place({
		placeid: place.placeid
	}, function (err, ret) {
		if (err) {
			throw new Error("Err at gmaps/place; placeid:", place.placeid, err);
		}
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
	var stypes = ["s1", "s2"];
	getPlaceDetails(place, function (err, details) {
		ret.types = Array.from(details.types);
		//getSubtypes(details, function(err, stypes) { todo only first 5 reviews
			ret.subtypes = stypes;
			cb(null, ret);
		//});
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
	return cb(null, locationMock);
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
			radius: config.nearby.radius,
			pagetoken: pagetoken,
			type: category
		} :
		{
			location: location,
			radius: config.nearby.radius,
			type: category
		};
	gclient.placesNearby(obj, function(err, ret) {
		result = result.concat(ret.json.results);
		if (result.length >= config.nearby.maxno || !(ret.json.next_page_token)) {
			return cb(null, result);
		}
		loopNearby(result, location, ret.json.next_page_token, category, cb);
	});	
}

function getNearbyPlaces(location, cb) {
	//return cb(null, townMock);
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

exports.getPlaces = function(townName, cb) {
	if (false ) {
		console.log("Town", townName, "already in cache!");
		return cb(null, {});
	}
	findLocation(townName, function(err, location) {
		getNearbyPlaces(location, function(err, places) {
			
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

var townMock = 
 [ { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/geocode-71.png',
       id: '6b1afbd7fcf2ec16ff8e2f95514e2badb8c2451d',
       name: 'Berlin',
       photos: [Array],
       place_id: 'ChIJAVkDPzdOqEcRcDteW0YgIQQ',
       reference: 'ChIJAVkDPzdOqEcRcDteW0YgIQQ',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '6b5d72b8d17287b3ac080da74006ff244f2ecf98',
       name: 'Citystay',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJ_w0FCuBRqEcRDIkoCnAigY4',
       plus_code: [Object],
       rating: 4,
       reference: 'ChIJ_w0FCuBRqEcRDIkoCnAigY4',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Rosenstraße 16, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '73cdf37e1b1e6259081acd57c24da72fff6fceb7',
       name: 'Radisson Blu Hotel, Berlin',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJLTX2ud9RqEcRtiblhC9s3Rg',
       plus_code: [Object],
       rating: 4.5,
       reference: 'ChIJLTX2ud9RqEcRtiblhC9s3Rg',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Karl-Liebknecht-Straße 3, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'a80e1a8b8c50a186a7cd0205b2f4d1447d50fae0',
       name: 'Hotel Alexander Plaza',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJG6Jmd-BRqEcRoQljfhnH0K0',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJG6Jmd-BRqEcRoQljfhnH0K0',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Rosenstraße 1, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '5f1037a9e9ac39a1fe9edf22b6553f2d6980babc',
       name: 'Adina Apartment Hotel Berlin Hackescher Markt',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJNTJq9OBRqEcR3jx__4NZNuk',
       plus_code: [Object],
       rating: 4.6,
       reference: 'ChIJNTJq9OBRqEcR3jx__4NZNuk',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'An der Spandauer Brücke 11, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '3d2b5c0713094a4b7b22e7e9c38ed88d44c305c2',
       name: 'Hotel Motel One Berlin-Hackescher Markt',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJg_Fz1B9OqEcRksIuXzrG3jg',
       plus_code: [Object],
       rating: 4.4,
       reference: 'ChIJg_Fz1B9OqEcRksIuXzrG3jg',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Dircksenstraße 36, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'b7a877b2fe0c6691aaa4b1fef9e13688088664ad',
       name: 'Hotel Hackescher Markt',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJf3vcx-BRqEcR2ipAIkznhos',
       plus_code: [Object],
       rating: 4.2,
       reference: 'ChIJf3vcx-BRqEcR2ipAIkznhos',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Große Präsidentenstraße 8, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '15a30c91a1e6d60d74feb14c3ab7e46b10e190d2',
       name: 'Alexanderplatz Apartments',
       photos: [Array],
       place_id: 'ChIJX2J0HtJRqEcRjZEO2tcquEU',
       plus_code: [Object],
       rating: 4.2,
       reference: 'ChIJX2J0HtJRqEcRjZEO2tcquEU',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Karl-Liebknecht-Straße 15, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '343fa2c18b7a06d127c1226736f7c9fc29e7616a',
       name: 'Park Inn by Radisson Berlin Alexanderplatz Hotel',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJ4Q7iHh9OqEcRoYdM_f1daq0',
       plus_code: [Object],
       rating: 4,
       reference: 'ChIJ4Q7iHh9OqEcRoYdM_f1daq0',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Alexanderplatz 7, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'ebf4cc4b8658be510d40ba147dd78f52437b5034',
       name: 'Casa Camper Berlin',
       photos: [Array],
       place_id: 'ChIJRZmsbuFRqEcReF1ChYn1nMY',
       plus_code: [Object],
       rating: 4.7,
       reference: 'ChIJRZmsbuFRqEcReF1ChYn1nMY',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Weinmeisterstraße 1, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '04d99178a00ac32c0e29cd49da7550ad0a168d77',
       name: 'ARCOTEL John F Berlin',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJj4R6a9lRqEcRXSgNFx13z3I',
       plus_code: [Object],
       rating: 4.4,
       reference: 'ChIJj4R6a9lRqEcRXSgNFx13z3I',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Werderscher Markt 11, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '973e6e13b0f0cf6e845962f6bba43dee88384662',
       name: 'Hotel Novotel Berlin Mitte',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJR5kGoSdOqEcRCiB4N4CC5rw',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJR5kGoSdOqEcRCiB4N4CC5rw',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Fischerinsel 12, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '355f9e35853b525bde0e5cfa1d1039ab3b1b689c',
       name: 'ibis Styles Hotel Berlin Alexanderplatz',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJI9r9j_1QqEcRwcSLNbjhW5k',
       plus_code: [Object],
       rating: 4,
       reference: 'ChIJI9r9j_1QqEcRwcSLNbjhW5k',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Bernhard-Weiß-Straße 8, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '097fb05acdb6a23c2b9ce74564fd22dfb7c10710',
       name: 'H2 Hotel Berlin-Alexanderplatz',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJGWPMkR5OqEcRl4KJ1LQHHRM',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJGWPMkR5OqEcRl4KJ1LQHHRM',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Karl-Liebknecht-Straße 32, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'db4b56ec966bd6ae8c611021c8ee654be29a2700',
       name: 'H4 Hotel Berlin Alexanderplatz',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJwUq6mx5OqEcREPAUaRdFmT4',
       plus_code: [Object],
       rating: 4.4,
       reference: 'ChIJwUq6mx5OqEcREPAUaRdFmT4',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Karl-Liebknecht-Straße 32, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '81e2ba351a552acddc464037043c2d0154725f20',
       name: 'Hotel de Rome',
       photos: [Array],
       place_id: 'ChIJsQ4OlttRqEcR3QNihxP152w',
       plus_code: [Object],
       rating: 4.5,
       reference: 'ChIJsQ4OlttRqEcR3QNihxP152w',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Behrenstraße 37, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'be2ec1a15295a28245f106453a3423b9e7317777',
       name: 'art\'otel berlin mitte',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJDxXSfyZOqEcRoyCJSyGWw2Y',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJDxXSfyZOqEcRoyCJSyGWw2Y',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Wallstraße 70-73, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: 'c369fa1a9a603b017e37023b9fe721a0c70e5e95',
       name: 'Living Hotel Berlin Mitte',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJSdgfZiZOqEcRGCO5jCISN1U',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJSdgfZiZOqEcRGCO5jCISN1U',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Neue Roßstraße 13, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '5f3cd387fd165fde745fc685ccba5a34386281fd',
       name: 'Hotel AMANO',
       photos: [Array],
       place_id: 'ChIJ4ydW9ONRqEcRL_JZWGWGVzg',
       plus_code: [Object],
       rating: 4.3,
       reference: 'ChIJ4ydW9ONRqEcRL_JZWGWGVzg',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Auguststraße 43, Berlin' },
     { geometry: [Object],
       icon: 'https://maps.gstatic.com/mapfiles/place_api/icons/lodging-71.png',
       id: '5ff9634b87ec4f0d516f3c5241b4895f686d10a7',
       name: 'Cosmo Hotel Berlin Mitte',
       opening_hours: [Object],
       photos: [Array],
       place_id: 'ChIJ77m8D9hRqEcRY5NPTAq9MF0',
       plus_code: [Object],
       rating: 4.4,
       reference: 'ChIJ77m8D9hRqEcRY5NPTAq9MF0',
       scope: 'GOOGLE',
       types: [Array],
       vicinity: 'Spittelmarkt 13, Berlin' }
];