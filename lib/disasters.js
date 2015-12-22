"use strict";
var log = require('../log'),
  models = require('../models'),
  async = require('async'),
  restify = require('restify'),
  _ = require('lodash');


// Fetch all disasters from the ReliefWeb API marked as active.
//
// Example API query for disasters, including extra fields and filtering out
// past (inactive) disasters:
// http://api.reliefweb.int/v1/disasters?fields[include][]=status&fields[include][]=glide&fields[include][]=country&filter[field]=status&filter[value]=past&filter[negate]=true&limit=1000
function fetchDisasters(operations, callback) {
  var client = restify.createJsonClient({
    url: process.env.HRINFO_BASE_URL
  }),
  limit = 50,
  page = 1,
  disasters = {},
  disaster;

  // Fetch a set of disasters, and allow recursion to get additional results.
  function fetchDisasterSet() {
    client.get('/api/v1.0/disasters?fields=id,operation,glide,label,reliefweb_id&range=' + limit + '&page=' + page,
      function(err, req, res, obj) {
        client.close();

        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.glide) {
              console.log("INFO: Invalid disaster data: " + JSON.stringify(item));
              return;
            }
            disaster = {
              glide_id: item.glide || '',
              name: item.label || '',
              countries: []
            };
            if (item.reliefweb_id && item.reliefweb_id.length) {
              disaster.remote_id = 'rwint:' + item.reliefweb_id;
            }
            else {
              disaster.remote_id = 'hrinfo:' + item.id;
            }
            _.forEach(item.operation, function (operation) {
              if (operations['hrinfo:' + operation.id] && operations['hrinfo:' + operation.id].iso3) {
                disaster.countries.push(operations['hrinfo:' + operation.id].iso3.toLowerCase());
              }
            });
            disasters[disaster.remote_id] = disaster;
          });
        }

        // Check for additional results
        if (obj.next && obj.next.href && obj.next.href.length) {
          page += 1;
          setTimeout(fetchDisasterSet, 500);
        }
        else {
          callback(null, disasters);
        }
      });
  }

  // Fetch the first set
  fetchDisasterSet();
}


// Store disasters in the cache.
function cacheDisasters(disasters, callback) {
  async.series([
    // Load the current disasters cache object, and merge in the new disasters.
    function (cb) {
      models.Cache.findOne({"name": "disasters"}, function (err, doc) {
        if (err) {
          return cb(err);
        }
        else if (doc && doc.data) {
          disasters = _.extend({}, doc.data, disasters);
        }
        cb();
      });
    },
    // Store the result.
    function (cb) {
      models.Cache.update({"name": "disasters"}, {"name": "disasters", "data": disasters}, {"upsert": true}, function (err, doc) {
        if (err) {
          return cb(err);
        }
        return cb(null);
      });
    }
  ], callback);
}


// Fetch disasters data and store in cache
function buildCache(callback, results) {
  fetchDisasters(results.operations, function (err, disasters) {
    if (err) {
      console.log("ERROR: Error when fetching disasters.", err);
      callback(err);
    }
    else {
      cacheDisasters(disasters, function (err) {
        if (err) {
          console.log("ERROR: Error when updating disasters cache.", err);
          callback(err);
        }
        else {
          console.log("SUCCESS: Retrieved and stored disaster data.");
          callback(null, disasters);
        }
      });
    }
  });
}


// Get the data for all disasters
function getDisasters(callback) {
  models.Cache.findOne({"name": "disasters"}, function (err, doc) {
    if (err) {
      return callback(err);
    }
    else if (doc && doc.data) {
      return callback(null, doc.data);
    }
  });
}


// Get the data for a specific disaster
function getDisaster(disasterId, callback) {
  getDisasters(function (err, disasters) {
    return callback(err, disasters ? disasters[disasterId] : null);
  });
}


// Expose module functions
exports.buildCache = buildCache;
exports.getAll = getDisasters;
exports.get = getDisaster;
