var _ = require('lodash'),
  	restify = require('restify'),
	_ = require('lodash'),
  	Contact = require('../models').Contact,
	Profile = require('../models').Profile,
	async = require('async');


//SCRIPT TO REMOVE ALL EXISTING DUPLICATES IN THE SUBSCRIPTIONS ARRAY 
function removeDuplicates(){ 
	var allProfiles = [],
		 temp = [];

	async.series([
		function (cb) {
			//Get a list all of profiles who have subscribed to a service
			Profile.find( {'subscriptions': { $exists: true, $ne: [] } }, function(err, profiles){
			if(err){
		  		console.log("500", new Error(err));
		  		return cb(true);
		  	}

		  	if(!profiles){
		  		console.log("400 No Profiles were found");
		  	}

		  	profiles.forEach(function(profile){
				profile.subscriptions = _.map(_.groupBy(profile.subscriptions,function(doc){
	              return doc.service;
	            }),function(grouped){
	              return grouped[0];
	            });

	            profile.save();			
			  	console.log(profile);
  			});
			return cb();
			});
		}
	])
}

