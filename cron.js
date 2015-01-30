var models = require('./models'),
  config = require('./config'),
  async = require('async'),
  restify = require('restify');

async.series([
  function (cb) {
    // Fetch the active operations list from HR.info
    var hrinfoBase = "http://dev1.humanitarianresponse.info";
    var url = hrinfoBase + "/hid/operations";
    var client = restify.createJsonClient({
      url: hrinfoBase,
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
  }
],
function (err, results) {
  console.log("Finished hid_profiles cron run.");
  process.exit();
});
