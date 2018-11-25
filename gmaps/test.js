gplaces = require('./places.js');

// placeid: "ChIJ89B_nZyUC0cRkJnbNATkv5E"

/*
gplaces.getPlaceTags({
	lat: "45.109136160115",
	lng: "24.363978608302",
	name: "blackcorner"
});
*/

/*
gplaces.getPlacesTags([
		{
			lat: "45.109136160115",
			lng: "24.363978608302",
			name: "blackcorner",
			placeid: "fake"
		}
	], function(err, ret) {
	console.log(err, ret);
});
*/

gplaces.getPlaces("Bucharest", function(err, ret) {
	
});

console.log("Test");