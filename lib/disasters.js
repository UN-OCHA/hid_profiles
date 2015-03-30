"use strict";
var config = require('../config'),
  log = require('../log'),
  models = require('../models'),
  async = require('async'),
  restify = require('restify'),
  _ = require('lodash');


// Fetch all disasters from the ReliefWeb API marked as active.
//
// Example API query for disasters, including extra fields and filtering out
// past (inactive) disasters:
// http://api.reliefweb.int/v1/disasters?fields[include][]=status&fields[include][]=glide&fields[include][]=country&filter[field]=status&filter[value]=past&filter[negate]=true&limit=1000
function fetchDisasters(callback) {
  var client = restify.createJsonClient({
    url: config.rwapiBaseUrl
  }),
  limit = 20,
  offset = 0,
  disasters = {},
  disaster;

  // Fetch a set of disasters, and allow recursion to get additional results.
  function fetchDisasterSet() {
    client.get('/v1/disasters?fields[include][]=status&fields[include][]=glide&fields[include][]=country&filter[field]=status&filter[value]=past&filter[negate]=true&limit=' + limit + '&offset=' + offset,
      function(err, req, res, obj) {
        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.id.length || !item.fields) {
              return;
            }
            disaster = {
              remote_id: 'rwint:' + item.id,
              glide_id: item.fields.glide || '',
              name: item.fields.name || '',
              countries: []
            };
            _.forEach(item.fields.country, function (country) {
              if (country.iso3 && country.iso3.length) {
                disaster.countries.push(country.iso3.toLowerCase());
              }
            });
            disasters[disaster.remote_id] = disaster;
          });
        }

        // Check for additional results
        if (obj.links && obj.links.next && obj.links.next.href && obj.links.next.href.length) {
          offset += limit;
          fetchDisasterSet();
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
        return cb();
      });
    }
  ], callback);
}


// Fetch disasters data and store in cache
function buildCache(callback) {
  fetchDisasters(function (err, disasters) {
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
          callback();
        }
      });
    }
  });
}


// collate disasters and operations data and store combos in cache
function collateOperationsDisasters(callback) {
  callback();
}


// helper function to get diasters for a given operation
function getDisastersByOperation(locationId, callback) {
  callback();
}


// Expose module functions
exports.buildCache = buildCache;
exports.collateOperationsDisasters = collateOperationsDisasters;
exports.getDisastersByOperation = getDisastersByOperation;
