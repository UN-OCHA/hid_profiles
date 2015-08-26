var models = require('./models'),
  _ = require('lodash'),
  async = require('async');

var profiles = [];
async.series([
  function(cb) {
    // Get all profiles with contacts.
    models.Profile.find({"contactLists":{$ne:null}}, function(err, data) {
      if (err) {
        return cb(err);
      }
      profiles = data;
      cb();
    });
  },
  function(cb) {
    // Loop through profiles and create new lists.
    async.each(profiles, function(profile, callback) {
      var list = new models.List({
        name: "My Contacts",
        userid: profile.userid,
        users: [profile.userid],
        contacts: profile.contactLists[0].contacts
      });

      list.save(function(err, list){
        if (err) {
          return callback(err);
        }

        console.log("Created list for " + profile.userid);
        callback();
      });
    }, function(err){
        if( err ) {
          cb(err);
        } else {
          cb();
        }
    });
  }
], function(err) {
  if (err) {
    console.log(err);
  } else {
    console.log("All lists have been migrated successfully.");
  }
  process.exit();
});
