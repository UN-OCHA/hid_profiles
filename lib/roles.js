var async = require('async'),
  _ = require('lodash'),
  Cache = require('../models').Cache,
  log = require('../log');

function getRoles(callback) {
  async.series([
    function (cb) {
      Cache.findOne({"name": "operations"}, function (err, doc) {
        if (err) {
          log.warn({'type': 'getRoles', 'message': 'Error occurred while trying to fetch the cached operations key.', 'err': err});
          return cb(err, null);
        }
        else if (doc && doc.data) {
          var ops = [];
          _.forEach(doc.data, function (item) {
            _.forEach(item, function (operation, opId) {
              if (opId.length && operation.name && operation.name.length) {
                var op = {
                  id: "manager:" + opId,
                  name: operation.name + " Manager"
                };
                ops.push(op);
                var op = {
                  id: "editor:" + opId,
                  name: operation.name + " Editor"
                };
                ops.push(op);
              }
            });
          });
          return cb(null, ops);
        }
        return cb(null, null);
      });
    }
  ], function (err, results) {
    var roles = [{"id": "admin", "name": "Administrator"}];
    _.forEach(results, function (items) {
      if (items && items.length) {
        roles = roles.concat(items);
      }
    });
    roles = roles.sort(function(a, b) { return (a.name > b.name) ? 1 : -1; });
    return callback(null, roles);
  });
}

// Checks if the given user profile includes the specified role. Role can be a
// string or regular expression.
function hasRole(userProfile, role) {
  return userProfile && userProfile.roles && arrayMatch(userProfile.roles, role) !== -1;
}

function arrayMatch(array, rx) {
  for (var i in array) {
    if (array[i].toString().match(rx)) {
      return i;
    }
  }
  return -1;
}

exports.get = getRoles;
exports.has = hasRole;
