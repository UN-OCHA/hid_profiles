var roles = require('../lib/roles.js');

function getProtectedRoles(callback) {
  async.series([
    function (cb) {
      Cache.findOne({"name": "protected_roles"}, function (err, doc) {
        if (err) {
          return cb(err, null);
        }
        else if (doc && doc.data) {
          var ops = [];
          _.forEach(doc.data, function (item) {
            _.forEach(item, function (role) {
              if (role.label && role.label.length) {
                var op = {
                  id: role.id,
                  name: role.label
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
   _.forEach(results, function (items) {
     if (items && items.length) {
       protected_roles = protected_roles.concat(items);
     }
   });
   protected_roles = protected_roles.sort(function(a, b) { return (a.name > b.name) ? 1 : -1; });
   return callback(null, protected_roles);
  });
}

function getAppData(req, res, next) {
  roles.get(function (err, data) {
    res.send({roles: data});
  });

  getProtectedRoles(function (err, data) {
    res.send({protectedRoles : data});
  });
}

exports.get = getAppData;
