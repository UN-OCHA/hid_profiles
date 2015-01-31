var async = require('async'),
  Cache = require('../models').Cache;

function getAppRoles(callback) {
  async.series([
    function (cb) {
      Cache.findOne({"name": "operations"}, function (err, doc) {
        if (err) {
          return cb(err, null);
        }
        if (doc && doc.data) {
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
      });
    }
  ], function (err, results) {
    var roles = [{"id": "admin", "name": "Administrator"}];
    _.forEach(results, function (items) {
      if (items.length) {
        roles = roles.concat(items);
      }
    });
    roles = roles.sort(function(a, b) { return (a.name > b.name) ? 1 : -1; });
    return callback(null, roles);
  });
}

function getAppData(req, res, next) {
  getAppRoles(function (err, data) {
    res.send({roles: data});
    next();
  });
}

exports.get = getAppRoles;
