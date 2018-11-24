const ssim = require('string-similarity');
const util = require('util');
const gclient = require('@google/maps').createClient({
  key: 'AIzaSyBUzjhA-C9VNcwZ15rrVkc5M_Am2leLQP4'
});
const redis = require('redis');
//const rediscli = redis.createClient(6379, "192.168.0.253");
//const placeSubtypes = require('../place-subtypes-generator');

const config = require('./config.json');

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

function getNearbyPlaces(location, cb) {
	gclient.placesNearby({
		location: location,
		radius: 50000
	}, function);
}

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

exports.getPlaces = function(townName, cb) {
	if (false ) {
		console.log("Town", townName, "already in cache!");
		return cb(null, {});
	}
	findLocation(townName, function(err, location) {
		
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

var townMock = {};