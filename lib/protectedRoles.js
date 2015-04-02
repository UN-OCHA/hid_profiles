var async = require('async'),
  _ = require('lodash'),
  restify = require('restify'),
  Cache = require('../models').Cache,
  config = require('../config'),
  models = require('../models'),
  log = require('../log');

function buildCache(callback) {
  // Fetch the functional roles list from HR.info
  var client = restify.createJsonClient({
    url: config.hrinfoBaseUrl,
    version: '*'
  }),
  protectedRoles = [];

  client.get("/api/v1.0/functional_roles", function(err, req, res, obj) {
    if (res.statusCode == 200 && res.body) {
      var obj = JSON.parse(res.body);
      if (!obj || !obj.data) {
        return callback(true, null);
      }

      _.forEach(obj.data, function (role) {
        if (role.id && role.label && role.label.length) {
          var op = {
            id: role.id.toString(),
            name: role.label
          };
          protectedRoles.push(op);
        }
      });

      //The HRInfo API names these roles "functional_roles", but we call them "protected_roles" in the app
      models.Cache.update({"name": "protected_roles"}, {"name": "protected_roles", "data": protectedRoles}, {"upsert": true}, function (err, doc) {
        if (err) {
          console.log("ERROR: Error when updating document.", err);
        }
        else {
          console.log("SUCCESS: Retrieved and stored functional (protected) roles.");
        }
        return callback(null, protectedRoles);
      });
    }
    else {
      console.log("ERROR: Fetched /api/v1.0/functional_roles. Did not receive successful response.");
      return callback(true);
    }
  });
}

function getProtectedRoles(callback) {
  Cache.findOne({"name": "protected_roles"}, function (err, doc) {
    if (err) {
      log.warn({'type': 'getProtectedRoles', 'message': 'Error occurred while trying to fetch the cached protected_roles key.', 'err': err});
      return callback(err, null);
    }
    else if (doc && doc.data) {
      return callback(null, doc.data.sort(function(a, b) { return (a.name > b.name) ? 1 : -1; }));
    }
    return callback(null, null);
  });
}

exports.buildCache = buildCache;
exports.get = getProtectedRoles;
