var async = require('async'),
	_ = require('lodash'),
	log = require('../log'),
	Profile = require('../models').Profile,
	Contact = require('../models').Contact,
	mail = require('../mail');

function matchInArray(stringSearch, arrayExpressions){
    var position = String(arrayExpressions).search(stringSearch);
    var result = (position > -1) ? true : false;
    return result;
}

function get(masterCb) {
	var allLocalProfilesWDigest = [],
		allLocalProfilesWOrgDigest =[],
		requiredLocationsId =[],
		reqLocIdOrgDigest =[],
		orgLoc =[],
		locations = [];
	
	async.series([
		function (cb) {
			//Get a list all of profiles who have the daily digest array and are verified
			Profile.find( {'dailyDigest': {$not: {$size: 0}}, 'verified': true}, function(err, profiles){
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
					//if profile roles does not contain manager or editor

	  				//forEach country
	  				profile.dailyDigest.forEach(function (location) {
		  				profile.roles.forEach(function(role){
	  						if(role.split(/:(.+)?/)[1] != 'undefined'){
			  					if(location == role.split(/:(.+)?/)[1] && (role.split(/:(.+)?/)[0] == 'manager' || role.split(/:(.+)?/)[0] == 'editor')){
					  				allLocalProfilesWDigest.push(profile);
									requiredLocationsId.push(location);
			  					}
			  					else {
			  						allLocalProfilesWOrgDigest.push(profile);
									reqLocIdOrgDigest.push(location);
			  					}
		  					}		
	  					})
					});
				}
		  	});
		  	return cb();
			});
		},
		function (cb){
			// console.log(allLocalProfilesWDigest ,allLocalProfilesWOrgDigest);
			async.forEachSeries(reqLocIdOrgDigest, function(location, callback2) {
				// console.log(location);
				Contact.find({$query: {type: 'local', locationId: location, created: {$gt: Date.now() - (24*60*60*1000)}, status: true, $and: [{organization: {$not: {$size: 0}}}, {organization: {$ne : null}}]}, $orderby : {location: -1} }, function (err, contacts){
					async.forEachSeries(contacts, function(contact, callback3){
						if(!contact){
							console.log("No users found1");
							return cb();
						}

						Contact.find({$query: {type: 'local', locationId: location, created: {$gt: Date.now() - (24*60*60*1000)},  status: true , 'organization.name': contact.organization[0].name}, $orderby : {location: -1}} , function (err, orgContacts){
							async.forEachSeries(orgContacts, function(orgContact, callback4){
								if(!orgContacts){
									console.log("No users found");
									return cb();
								}

								if(!locations[orgContact.locationId])
								{
									locations[orgContact.locationId] = {};
									locations[orgContact.locationId].orgContacts = [];
									locations[contact.locationId].name = contact.location;
									locations[contact.locationId].checkedInUsers = [];
									locations[contact.locationId].checkedOutUsers = [];
								}
									
								locations[orgContact.locationId].orgContacts.push(orgContact);
								// console.log(locations[orgContact.locationId].orgContacts);
								callback4();
							})
						});
						callback3();
					});
					callback2(); 
				})
			}, cb);
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
		function(cb){
			var mailOptions = {},
				tempOrgLocation =[],
			    current = new Date();
			mailOptions.locations = locations;
			mailOptions.baseUrl = process.env.APP_BASE_URL;
			mailOptions.subject = 'Humanitarian ID daily digest';
			// For each manager with a digest
			async.forEachSeries(allLocalProfilesWOrgDigest, function(profile, cb3) {
				mailOptions.orgContacts = false;
				// See if a digest needs to be sent out
				profile.dailyDigest.forEach(function (locationId) {
					if(locations[locationId]){
						if(locations[locationId].orgContacts.length) {
							mailOptions.orgContacts = true;
							if(tempOrgLocation.indexOf(locationId) === -1)
								tempOrgLocation.push(locationId);
						}
					}
				});
				console.log(mailOptions);
				// If there is something to be sent out in the digest
				if (mailOptions.orgContacts === true) {
					// Find the global contact associated to the profile
					Contact.findOne({ type: 'global', _profile: profile._id }, function (err, contact) {
						if (!err && contact) {
							// Send the email
							mailOptions.to = contact.email[0].address;
							mailOptions.nameGiven = contact.nameGiven;
							mailOptions.dailyDigest = tempOrgLocation;
							if(mailOptions.orgContacts === true)
							{

								mail.sendTemplate('daily_digest_organization', mailOptions, function (err, info) {
	                    			if (err) {
										console.log("ERR", err);
									}
									cb3();
								});
							}
						}
					});
				}
				else {
					cb3();
				}
			});
			return cb();
		},
		function (cb) {
			var mailOptions = {},
				tempDigestLocation = [], 
			    current = new Date();
			mailOptions.locations = locations;
			mailOptions.baseUrl = process.env.APP_BASE_URL;
			mailOptions.subject = 'Humanitarian ID daily digest';
			// For each manager with a digest
			async.forEachSeries(allLocalProfilesWDigest, function(profile, cb3) {
				mailOptions.checkedIn = false;
				mailOptions.checkedOut = false;
				// See if a digest needs to be sent out
				profile.dailyDigest.forEach(function (locationId) {
					if(locations[locationId]){
						if (locations[locationId].checkedInUsers.length) {
							mailOptions.checkedIn = true;
							if(tempDigestLocation.indexOf(locationId) === -1)
								tempDigestLocation.push(locationId);
						}
						if (locations[locationId].checkedOutUsers.length) {
							mailOptions.checkedOut = true;
							if(tempDigestLocation.indexOf(locationId) === -1)
								tempDigestLocation.push(locationId);
						}
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
							mailOptions.dailyDigest = tempDigestLocation;
							if(mailOptions.checkedIn === true || mailOptions.checkedOut === true){
								mail.sendTemplate('daily_digest', mailOptions, function (err, info) {
                    				if (err) {
										console.log("ERR", err);
									}
									else {
										profile.lastDigestSent = current.toISOString();
										profile.save();
									}
									cb3();
								});
							}
						}
					});
				}
				else {
					cb3();
				}
			});
			return cb();
		}
	], masterCb);
}

exports.get = get;

