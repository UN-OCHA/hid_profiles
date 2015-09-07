var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  models = require('../models'),
  restify = require('restify'),
  config = require('../config');


// Fetch all operations from the HumanitarianResponse API which are not marked as inactive.
//
// Example API query for active operations:
// http://www.humanitarianresponse.info/api/v1.0/operations?filter[hid_access][value]=inactive&filter[hid_access][operator]=!=
function fetchOperations(callback) {
  var client = restify.createJsonClient({
    url: config.hrinfoBaseUrl
  }),
  operations = {},
  operation,
  page = 1;

  // Fetch a set of operations, and allow recursion to get additional results.
  function fetchOperationSet() {
    client.get('/api/v1.0/operations?filter[hid_access][value]=inactive&filter[hid_access][operator]=!=&page=' + page,
      function(err, req, res, obj) {
        client.close();

        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.label || !item.country || !item.country.iso3 || !item.country.pcode) {
              console.log("INFO: Invalid operation data: " + JSON.stringify(item));
              return;
            }
            operation = {
              remote_id: 'hrinfo:' + item.id,
              name: item.label,
              status: item.status,
              hid_access: item.hid_access,
              pcode: item.country.pcode.toLowerCase(),
              iso3: item.country.iso3.toLowerCase(),
              bundles: {},
              disasters: {},
              offices: {}
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
    },
    // Store cache of locked operations.
    function (cb) {
      var operationsLocked = [];
      _.forEach(operations, function (item) {
        if (item.remote_id && item.hid_access === 'closed') {
          operationsLocked.push(item.remote_id);
        }
      });
      models.Cache.update({"name": "operationsLocked"}, {"name": "operationsLocked", "data": operationsLocked}, {"upsert": true}, function (err, doc) {
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
          callback(null, operations);
        }
      });
    }
  });
}


// Collate disasters and bundles with operations to build the core app data.
function buildAppData(callback, results) {
  var appData = {
    operations: results.operations,
    protectedRoles: results.protectedRoles,
    orgTypes: results.orgTypes,
    roles: {}
  };

  async.series([
    // Collate bundles into operations
    function (cb) {
      _.forEach(results.bundles, function (item) {
        if (item.remote_id && item.operation_id && appData.operations.hasOwnProperty(item.operation_id)) {
          appData.operations[item.operation_id].bundles[item.remote_id] = item;
        }
      });
      cb();
    },
    // Collate offices into operations
    function (cb) {
      _.forEach(results.offices, function (item) {
        if (item.remote_id && item.operation_id && appData.operations.hasOwnProperty(item.operation_id)) {
          appData.operations[item.operation_id].offices[item.remote_id] = item;
        }
      });
      cb();
    },
    // Collate disasters into operations
    function (cb) {
      // Generate map of iso3 country codes to disasters
      var countryDisasters = {};
      _.forEach(results.disasters, function (item) {
        if (item.remote_id && item.countries && item.countries.length) {
          _.forEach(item.countries, function (iso3) {
            if (!countryDisasters[iso3] || !countryDisasters[iso3].push) {
              countryDisasters[iso3] = [];
            }
            countryDisasters[iso3].push(item);
          });
        }
      });

      _.forEach(results.operations, function (item) {
        if (item.iso3 && countryDisasters.hasOwnProperty(item.iso3)) {
          item.disasters = countryDisasters[item.iso3];
        }
      });

      cb();
    },
    // Retrieve roles
    function (cb) {
      require('../lib/roles').get(function (err, data) {
        appData.roles = data;
        return cb();
      });
    }
  ], function (err, res) {
    if (err) {
      console.log("ERROR: Error when collating data for the app data cache.");
      return callback(err);
    }

    models.Cache.update({"name": "appData"}, {"name": "appData", "data": appData}, {"upsert": true}, function (err, doc) {
      if (err) {
        console.log("ERROR: Error when updating the app data cache.");
        return callback(err);
      }
      else {
        console.log("SUCCESS: Generated and stored app data.");
        return callback();
      }
    });
  });
}


// Filter out contacts related to locked operations from an array.
function filterLockedOperations(contacts, callback) {
  getLockedOperations(function (err, lockedOperations) {
    if (err || !lockedOperations || !lockedOperations.indexOf) {
      return callback(err, null);
    }
    var filtered = contacts.filter(function (val, idx) {
      // Allow global contacts
      if (val && val.type && val.type === 'global') {
        return true;
      }
      // Allow local contacts that are not locked
      else if (val && val.type && val.type === 'local' && val.locationId && lockedOperations.indexOf(val.locationId) === -1) {
        return true;
      }
      // Exclude all others
      return false;
    });
    return callback(null, filtered);
  });
}


// Get a list of locked operations as an array of locationIDs.
function getLockedOperations(callback) {
  models.Cache.findOne({"name": "operationsLocked"}, function (err, doc) {
    return callback(err, doc ? doc.data : []);
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

// Get app data
function getAppData(callback) {
  models.Cache.findOne({"name": "appData"}, function (err, doc) {
    if (err || !doc || !doc.data) {
      return callback(err);
    }

    return callback(null, doc.data);
  });
}


// Expose module functions
exports.buildCache = buildCache;
exports.buildAppData = buildAppData;
exports.filterLockedOperations = filterLockedOperations;
exports.getLockedOperations = getLockedOperations;
exports.getAll = getOperations;
exports.get = getOperation;
exports.getAppData = getAppData;
