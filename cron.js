var models = require('./models'),
  config = require('./config'),
  disasters = require('./lib/disasters'),
  async = require('async'),
  restify = require('restify');

async.series([
  function (cb) {
    // Fetch the active operations list from HR.info
    var client = restify.createJsonClient({
      url: config.hrinfoBaseUrl,
      version: '*'
    });
    client.get("/hid/operations", function(err, req, res, obj) {
      if (res.statusCode == 200 && res.body) {
        var obj = JSON.parse(res.body);
        if (!obj) {
          return cb();
        }
        models.Cache.update({"name": "operations"}, {"name": "operations", "data": obj}, {"upsert": true}, function (err, doc) {
          if (err) {
            console.log("ERROR: Error when updating document.", err);
          }
          else {
            console.log("SUCCESS: Retrieved and stored operation data.");
          }
          return cb();
        });
      }
      else {
        console.log("ERROR: Fetched /hid/operations. Did not receive successful response.");
        return cb();
      }
    });
  },
  function (cb) {
    // Fetch the functional roles list from HR.info
    var client = restify.createJsonClient({
      url: config.hrinfoBaseUrl,
      version: '*'
    });
    client.get("/api/v1.0/functional_roles", function(err, req, res, obj) {
      if (res.statusCode == 200 && res.body) {
        var obj = JSON.parse(res.body);
        if (!obj) {
          return cb();
        }
        //The HRInfo API names these roles "functional_roles", but we call them "protected_roles" in the app
        models.Cache.update({"name": "protected_roles"}, {"name": "protected_roles", "data": obj}, {"upsert": true}, function (err, doc) {
          if (err) {
            console.log("ERROR: Error when updating document.", err);
          }
          else {
            console.log("SUCCESS: Retrieved and stored functional (protected) roles.");
          }
          return cb();
        });
      }
      else {
        console.log("ERROR: Fetched /api/v1.0/functional_roles. Did not receive successful response.");
        return cb();
      }
    });
  },
  disasters.buildCache,
  disasters.collateOperationsDisasters
],
function (err, results) {
  console.log("Finished hid_profiles cron run.");
  process.exit();
});
