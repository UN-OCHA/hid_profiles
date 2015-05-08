var async = require('async'),
  _ = require('lodash'),
  restify = require('restify'),
  Cache = require('../models').Cache,
  config = require('../config'),
  models = require('../models'),
  log = require('../log');

function buildCache(callback) {
  // Fetch the organization types list from HR.info
  var client = restify.createJsonClient({
    url: config.hrinfoBaseUrl,
    version: '*'
  }),
  orgTypes = [];

  client.get("/api/v1.0/organization_types", function(err, req, res, obj) {
    client.close();

    if (res && res.statusCode == 200 && res.body) {
      var obj = JSON.parse(res.body);
      if (!obj || !obj.data) {
        return callback(true, null);
      }

      _.forEach(obj.data, function (orgType) {
        if (orgType.id && orgType.label && orgType.label.length) {
          var op = {
            id: 'hrinfo_org_type_' + orgType.id.toString(),
            name: orgType.label
          };
          orgTypes.push(op);
        }
      });
      orgTypes.sort(function(a, b) { return (a.name > b.name) ? 1 : -1; });

      models.Cache.update({"name": "org_types"}, {"name": "org_types", "data": orgTypes}, {"upsert": true}, function (err, doc) {
        if (err) {
          console.log("ERROR: Error when updating document.", err);
        }
        else {
          console.log("SUCCESS: Retrieved and stored organization types.");
        }
        return callback(null, orgTypes);
      });
    }
    else {
      console.log("ERROR: Fetched /api/v1.0/organization_types. Did not receive successful response.");
      return callback(true);
    }
  });
}

function getOrgTypes(callback) {
  Cache.findOne({"name": "org_types"}, function (err, doc) {
    if (err) {
      log.warn({'type': 'getOrgTypes', 'message': 'Error occurred while trying to fetch the cached org_types key.', 'err': err});
      return callback(err, null);
    }
    else if (doc && doc.data) {
      return callback(null, doc.data);
    }
    return callback(null, null);
  });
}

exports.buildCache = buildCache;
exports.get = getOrgTypes;
