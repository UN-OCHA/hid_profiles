var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  models = require('../models'),
  restify = require('restify'),
  config = require('../config');


// Fetch all operations from the HumanitarianResponse API marked as active and
// related to a country.
//
// Example API query for active, country-based operations:
// http://www.humanitarianresponse.info/api/v1.0/operations?filter[type]=country&filter[status]=active
function fetchOperations(callback) {
  var client = restify.createJsonClient({
    url: config.hrinfoBaseUrl
  }),
  operations = {},
  operation,
  page = 1;

  // Fetch a set of disasters, and allow recursion to get additional results.
  function fetchOperationSet() {
    client.get('/api/v1.0/operations?filter[type]=country&filter[status]=active&page=' + page,
      function(err, req, res, obj) {
        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.label || !item.country) {
              return;
            }
            operation = {
              remote_id: 'hrinfo:' + item.id,
              name: item.label,
              status: item.status,
              hid_access: item.hid_access,
              pcode: item.country.pcode.toLowerCase(),
              iso3: item.country.iso3.toLowerCase()
            };
            operations[operation.remote_id] = operation;
          });
        }

        // Check for additional results
        if (obj.next && obj.next.href && obj.next.href.length) {
          page++;
          fetchOperationSet();
        }
        else {
          callback(null, operations);
        }
      });
  }

  // Fetch the first set
  fetchOperationSet();
}


// Store operations in the cache.
function cacheOperations(operations, callback) {
  async.series([
    // Load the current operations cache object, and merge in the new operations.
    function (cb) {
      models.Cache.findOne({"name": "operations"}, function (err, doc) {
        if (err) {
          return cb(err);
        }
        else if (doc && doc.data) {
          operations = _.extend({}, doc.data, operations);
        }
        cb();
      });
    },
    // Store the result.
    function (cb) {
      models.Cache.update({"name": "operations"}, {"name": "operations", "data": operations}, {"upsert": true}, function (err, doc) {
        return cb(err);
      });
    }
  ], callback);
}


// Fetch operations data and store in cache
function buildCache(callback) {
  fetchOperations(function (err, operations) {
    if (err) {
      console.log("ERROR: Error when fetching operations.", err);
      callback(err);
    }
    else {
      cacheOperations(operations, function (err) {
        if (err) {
          console.log("ERROR: Error when updating operations cache.", err);
          callback(err);
        }
        else {
          console.log("SUCCESS: Retrieved and stored operation data.");
          callback();
        }
      });
    }
  });
}


// Get the data for all operations
function getOperations(callback) {
  models.Cache.findOne({"name": "operations"}, function (err, doc) {
    if (err) {
      return callback(err);
    }
    else if (doc && doc.data) {
      return callback(null, doc.data);
    }
  });
}


// Get the data for a specific operation
function getOperation(operationId, callback) {
  getOperations(function (err, operations) {
    return callback(err, operations ? operations[operationId] : null);
  });
}


// Expose module functions
exports.buildCache = buildCache;
exports.getAll = getOperations;
exports.get = getOperation;
