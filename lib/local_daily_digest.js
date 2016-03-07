var async = require('async'),
	_ = require('lodash'),
	log = require('../log'),
	Profile = require('../models').Profile,
	Contact = require('../models').Contact,
	mail = require('../mail');

function get() {
	var allLocalProfilesWDigest = [],
		requiredLocationsId =[],
		locations = [];
	
	async.series([
		function (cb) {
			//Get a list all of profiles who have the daily digest array and are verified
			Profile.find( {'dailyDigest': {$not: {$size: 0}}, 'verified': true }, function(err, profiles){
			if(err){
		  		console.log("500", new Error(err));
		  		return cb(true);
		  	}

		  	if(!profiles){
		  		console.log("400 No Profiles were found");
		  	}

			var current = new Date();

		  	profiles.forEach(function(profile){
				var lastDigestSent = profile.lastDigestSent ? profile.lastDigestSent : 0;
				lastDigestSent = new Date(lastDigestSent);
				var offset = current.valueOf() - lastDigestSent.valueOf();
				if (offset > 24 * 60 * 60 * 1000) { // If last digest was sent more than 24 hours ago
	  				allLocalProfilesWDigest.push(profile);
					// For all the profiles which want to get a digest, get a list of the locations they want a digest for
					profile.dailyDigest.forEach(function (location) {
						requiredLocationsId.push(location);
					});
				}
		  	});

			console.log("the countries these managers/editors want the dailyDigest for are: ", requiredLocationsId);

  			return cb();
			});
		},
		function(cb){
			//Get a list of all checked in users in the last 24 hours for those locations
			async.forEachSeries(requiredLocationsId, function(location, callback2) {
				Contact.find({$query: {type: 'local', locationId: location, created: {$gt: Date.now() - (24*60*60*1000)}, status: true}, $orderby : {location: -1} }, function (err, contact){
					contact.forEach(function(contact){
						if(!contact){
							console.log("No users found1");
							return cb();
						}

						if (!locations[contact.locationId]) {
							locations[contact.locationId] = {};
							locations[contact.locationId].name = contact.location;
							locations[contact.locationId].checkedInUsers = [];
							locations[contact.locationId].checkedOutUsers = [];
						}

						locations[contact.locationId].checkedInUsers.push(contact);

					});
					callback2(); 
				})
			}, cb);
		},	
		function (cb){
			//Get a list of all checked out users in the last 24 hours for those locations
			var i = 0;
			async.forEachSeries(requiredLocationsId, function(location, callback2) {
				Contact.find({ $query: { type: 'local', locationId: location, revised: {$gt: Date.now() - (24*60*60*1000)}, status: false},  $orderby : {location: -1} }, function (err, contact){
						contact.forEach(function(contact){
							if(!contact){
								console.log("No users found1");
								return cb();
							}

							if (!locations[contact.locationId]) {
								locations[contact.locationId] = {};
								locations[contact.locationId].name = contact.location;
								locations[contact.locationId].checkedInUsers = [];
								locations[contact.locationId].checkedOutUsers = [];
							}

							locations[contact.locationId].checkedOutUsers.push(contact);

					});	
				    callback2(); 
				})
			}, cb)
		},
		function (cb) {
			var mailOptions = {},
			    current = new Date();
			mailOptions.locations = locations;
			mailOptions.baseUrl = process.env.APP_BASE_URL;
			mailOptions.subject = 'Humanitarian ID daily digest';
			// For each manager with a digest
			allLocalProfilesWDigest.forEach(function (profile) {
				mailOptions.checkedIn = false;
				mailOptions.checkedOut = false;
				// See if a digest needs to be sent out
				profile.dailyDigest.forEach(function (locationId) {
					if (locations[locationId].checkedInUsers.length) {
						mailOptions.checkedIn = true;
					}
					if (locations[locationId].checkedOutUsers.length) {
						mailOptions.checkedOut = true;
					}
				});
			
				// If there is something to be sent out in the digest
				if (mailOptions.checkedIn === true || mailOptions.checkedOut === true) {
					// Find the global contact associated to the profile
					Contact.findOne({ type: 'global', _profile: profile._id }, function (err, contact) {
						if (!err && contact) {
							// Send the email
							mailOptions.to = contact.email[0].address;
							mailOptions.nameGiven = contact.nameGiven;
							mailOptions.dailyDigest = profile.dailyDigest
							mail.sendTemplate('daily_digest', mailOptions, function (err, info) {
		                        			if (err) {
									console.log("ERR", err);
								}
								else {
									profile.lastDigestSent = current.toISOString();
									profile.save();
								}
							});
						}
					});
				}
			});
			return cb();
		}
	]);
}


exports.get = get;

